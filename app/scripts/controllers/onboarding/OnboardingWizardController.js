/*
 * Client-to-loan onboarding wizard.
 *
 * Two modes:
 *   - new:      creates the customer and the loan together (#/onboarding)
 *   - existing: opens a new loan for a customer who is already registered (#/onboarding/existing, #/onboarding/client/:id)
 *
 * Collects client details (or picks the existing customer), identifiers, collateral (pawn items), guarantors and
 * co-borrowers (existing customers or new ones created on the fly), loan terms and optional approval/disbursement,
 * then submits everything in ONE call: POST /batches?enclosingTransaction=true. Every request in the batch goes
 * through the normal Fineract command handlers (validation, permissions, audit, maker-checker) and the whole batch
 * is rolled back if any request fails, so the wizard never leaves a half-created client or loan behind.
 *
 * Identifier document files are multipart uploads and cannot be part of the batch; they are uploaded after the
 * batch has committed, with a per-file retry.
 */
(function (module) {
    mifosX.controllers = _.extend(module, {
        OnboardingWizardController: function (scope, rootScope, resourceFactory, location, dateFilter, API_VERSION, Upload, $q, routeParams) {

            var DRAFT_KEY = 'mifosx.onboardingWizard.draft.v2';
            var GUARANTOR_TYPE_CUSTOMER = 1;
            var CLIENT_STATUS_ACTIVE = 300;
            var PARTY_LISTS = ['guarantors', 'coBorrowers'];
            var ROLLBACK_PREFIX = 'Transaction is being rolled back. First erroneous request:';
            var ON_DEMAND_CHARGE_TIME = 17;
            var SPECIFIED_DUE_DATE_CHARGE_TIME = 2;
            var MAKER_CHECKER_BLOCKING = ['CREATE_CLIENT', 'CREATE_CLIENTIDENTIFIER', 'CREATE_LOAN', 'CREATE_COLLATERAL', 'CREATE_GUARANTOR',
                'CREATE_LOANCOBORROWER'];

            var ALL_STEPS = [
                {key: 'customer', icon: 'fa-user-circle', title: 'label.heading.onboarding.step.customer'},
                {key: 'client', icon: 'fa-user', title: 'label.heading.onboarding.step.client'},
                {key: 'identifiers', icon: 'fa-id-card-o', title: 'label.heading.onboarding.step.identifiers'},
                {key: 'collateral', icon: 'fa-diamond', title: 'label.heading.onboarding.step.collateral'},
                {key: 'parties', icon: 'fa-users', title: 'label.heading.onboarding.step.parties'},
                {key: 'loan', icon: 'fa-money', title: 'label.heading.onboarding.step.loan'},
                {key: 'schedule', icon: 'fa-table', title: 'label.heading.onboarding.step.schedule'},
                {key: 'approval', icon: 'fa-check-square-o', title: 'label.heading.onboarding.step.approval'},
                {key: 'review', icon: 'fa-flag-checkered', title: 'label.heading.onboarding.step.review'}
            ];

            // ------------------------------------------------------------------ state
            function emptyGeo() {
                return {provinceId: null, districtId: null, communeId: null, villageId: null, districts: [], communes: [], villages: []};
            }

            function newState() {
                var today = new Date();
                var firstStep = scope.mode === 'existing' ? 'customer' : 'client';
                var visited = {};
                visited[firstStep] = true;
                return {
                    stepKey: firstStep,
                    visited: visited,
                    client: {
                        officeId: null, staffId: null, legalFormId: 1,
                        firstname: '', middlename: '', lastname: '', fullname: '',
                        genderId: null, mobileNo: '', externalId: '', clientTypeId: null, clientClassificationId: null,
                        dateOfBirth: null, activationDate: today,
                        address: {}
                    },
                    living: emptyGeo(),
                    birth: emptyGeo(),
                    identifiers: [],
                    collaterals: [],
                    guarantors: [],
                    coBorrowers: [],
                    loan: {
                        productId: null, charges: [],
                        submittedOnDate: today, expectedDisbursementDate: today, repaymentsStartingFromDate: null
                    },
                    approval: {
                        approve: false, disburse: false,
                        approvedOnDate: today, approvedLoanAmount: null,
                        actualDisbursementDate: today, transactionAmount: null, paymentTypeId: null, note: ''
                    }
                };
            }

            // ------------------------------------------------------------------ mode
            var routeClientId = routeParams.clientId ? parseInt(routeParams.clientId, 10) : null;
            scope.mode = (routeClientId || location.path() === '/onboarding/existing') ? 'existing' : null;
            if (!scope.mode) {
                // a new-customer draft in progress skips the chooser
                try {
                    if (window.localStorage.getItem(DRAFT_KEY)) {
                        scope.mode = 'new';
                    }
                } catch (ignore) {
                    // storage unavailable
                }
            }
            scope.customer = {data: null, identifiers: [], loans: [], loading: false, error: null};
            scope.customerSearch = {selected: null};

            scope.chooseMode = function (mode) {
                if (mode === 'existing') {
                    location.path('/onboarding/existing');
                    return;
                }
                scope.mode = 'new';
                scope.ob = newState();
                if (scope.opt.offices.length > 0 && !scope.ob.client.officeId) {
                    scope.ob.client.officeId = scope.opt.offices[0].id;
                    scope.changeOffice(scope.ob.client.officeId, true);
                }
            };

            scope.ob = newState();
            scope.files = {};            // identifier index -> File (never stored in the draft)
            scope.opt = {provinces: [], offices: [], staffs: [], loanProducts: [], documentTypes: [], collateralTypes: [], paymentTypes: [], chargeOptions: []};
            scope.loanTemplate = null;
            scope.schedule = {data: null, payloadHash: null, loading: false, error: null};
            scope.ui = {errors: [], submitting: false, draftRestored: false, result: null, uploads: [], open: {}};
            scope.mc = {selected: [], approve: false, disburse: false};
            scope.can = {
                create: rootScope.hasPermission('CREATE_CLIENT') && rootScope.hasPermission('CREATE_LOAN'),
                approve: rootScope.hasPermission('APPROVE_LOAN'),
                disburse: rootScope.hasPermission('DISBURSE_LOAN')
            };
            scope.today = new Date();

            // ------------------------------------------------------------------ helpers
            function fmt(date) {
                return date ? dateFilter(date, scope.df) : undefined;
            }

            function startOfDay(d) {
                var x = new Date(d);
                x.setHours(0, 0, 0, 0);
                return x;
            }

            function isFuture(d) {
                return d && startOfDay(d) > startOfDay(new Date());
            }

            function isBefore(a, b) {
                return a && b && startOfDay(a) < startOfDay(b);
            }

            function num(v) {
                var n = parseFloat(v);
                return isNaN(n) ? null : n;
            }

            function toDate(v) {
                if (!v) {
                    return null;
                }
                return _.isArray(v) ? new Date(v[0], v[1] - 1, v[2]) : new Date(v);
            }

            function findById(list, id) {
                return _.find(list || [], function (o) {
                    return o.id == id;
                });
            }

            scope.findById = findById;

            // ------------------------------------------------------------------ steps
            scope.steps = function () {
                return _.filter(ALL_STEPS, function (s) {
                    if (s.key === 'client') {
                        return scope.mode !== 'existing';
                    }
                    if (s.key === 'customer') {
                        return scope.mode === 'existing';
                    }
                    return s.key !== 'approval' || scope.showApprovalStep();
                });
            };

            scope.showApprovalStep = function () {
                return scope.can.approve && !scope.mc.approve;
            };

            scope.stepIndex = function (key) {
                return _.findIndex(scope.steps(), {key: key || scope.ob.stepKey});
            };

            scope.isStep = function (key) {
                return scope.ob.stepKey === key;
            };

            scope.goTo = function (key) {
                // forward jumps only to steps already visited; backward always allowed
                if (scope.stepIndex(key) > scope.stepIndex() && !scope.ob.visited[key]) {
                    return;
                }
                scope.ui.errors = [];
                scope.ob.stepKey = key;
                onEnterStep(key);
                saveDraft();
                window.scrollTo(0, 0);
            };

            scope.next = function () {
                var errors = validateStep(scope.ob.stepKey);
                scope.ui.errors = errors;
                if (errors.length > 0) {
                    return;
                }
                var steps = scope.steps();
                var idx = scope.stepIndex();
                if (idx < steps.length - 1) {
                    var nextKey = steps[idx + 1].key;
                    scope.ob.visited[nextKey] = true;
                    scope.goTo(nextKey);
                }
            };

            scope.back = function () {
                var steps = scope.steps();
                var idx = scope.stepIndex();
                if (idx > 0) {
                    scope.goTo(steps[idx - 1].key);
                }
            };

            function onEnterStep(key) {
                if (key === 'schedule') {
                    scope.previewSchedule();
                }
                if (key === 'approval' && scope.ob.approval.approvedLoanAmount == null) {
                    scope.ob.approval.approvedLoanAmount = num(scope.ob.loan.principal);
                }
            }

            // ------------------------------------------------------------------ reference data
            resourceFactory.clientTemplateResource.get({staffInSelectedOfficeOnly: true}, function (data) {
                scope.clientTemplate = data;
                scope.opt.offices = data.officeOptions || [];
                scope.opt.staffs = data.staffOptions || [];
                if (!scope.ob.client.officeId && scope.opt.offices.length > 0) {
                    scope.ob.client.officeId = scope.opt.offices[0].id;
                }
                if (scope.ob.client.officeId) {
                    scope.changeOffice(scope.ob.client.officeId, true);
                }
            });

            resourceFactory.provinceResource.getAllProvinces(function (data) {
                scope.opt.provinces = data;
            });

            // the identifier template does not depend on a client (it reads the "Customer Identifier" code)
            resourceFactory.clientIdenfierTemplateResource.get({clientId: 0}, function (data) {
                scope.opt.documentTypes = data.allowedDocumentTypes || [];
            });

            // collateral types are the values of the "LoanCollateral" code (Admin > System > Codes)
            resourceFactory.loanResource.get({resourceType: 'template', templateType: 'collateral'}, function (data) {
                scope.opt.collateralTypes = data.loanCollateralOptions || [];
            });

            resourceFactory.paymentTypeResource.getAll(function (data) {
                scope.opt.paymentTypes = data;
            });

            resourceFactory.loanResource.get({resourceType: 'template', templateType: 'individual', activeOnly: 'true'}, function (data) {
                scope.opt.loanProducts = data.productOptions || [];
                if (scope.ob.loan.productId) {
                    scope.loanProductChange(scope.ob.loan.productId, true);
                }
            });

            // Maker-checker: a parked command returns no ids, so the batch could not continue. Detect it up front.
            resourceFactory.configurationResource.get(function (data) {
                var config = _.find(data.globalConfiguration || [], {name: 'maker-checker'});
                if (!config || !config.enabled) {
                    return;
                }
                resourceFactory.permissionResource.get({makerCheckerable: true}, function (permissions) {
                    var selected = _.pluck(_.filter(permissions, {selected: true}), 'code');
                    scope.mc.selected = selected;
                    scope.mc.approve = _.contains(selected, 'APPROVE_LOAN');
                    scope.mc.disburse = _.contains(selected, 'DISBURSE_LOAN');
                    if (scope.mc.approve) {
                        scope.ob.approval.approve = false;
                    }
                    if (scope.mc.disburse) {
                        scope.ob.approval.disburse = false;
                    }
                });
            });

            // Existing customer: CREATE_CLIENT under maker-checker only matters when a new guarantor/co-borrower is created.
            scope.mcBlocked = function () {
                var needed = _.without(MAKER_CHECKER_BLOCKING, 'CREATE_CLIENT');
                var createsClients = scope.mode !== 'existing' || _.some(PARTY_LISTS, function (list) {
                    return _.some(scope.ob[list], function (row) {
                        return row.mode === 'new';
                    });
                });
                if (createsClients) {
                    needed.push('CREATE_CLIENT');
                }
                return _.intersection(scope.mc.selected || [], needed).length > 0;
            };

            scope.changeOffice = function (officeId, keepStaff) {
                if (!keepStaff) {
                    scope.ob.client.staffId = null;
                }
                resourceFactory.clientTemplateResource.get({staffInSelectedOfficeOnly: true, officeId: officeId}, function (data) {
                    scope.opt.staffs = data.staffOptions || [];
                });
            };

            // ------------------------------------------------------------------ existing customer
            function loadCustomer(clientId) {
                scope.customer.loading = true;
                scope.customer.error = null;
                resourceFactory.clientResource.get({clientId: clientId}, function (data) {
                    scope.customer.loading = false;
                    scope.customer.data = {
                        id: data.id,
                        displayName: data.displayName,
                        accountNo: data.accountNo,
                        externalId: data.externalId,
                        officeId: data.officeId,
                        officeName: data.officeName,
                        staffId: data.staffId,
                        staffName: data.staffName,
                        mobileNo: data.mobileNo,
                        active: !!data.active,
                        status: data.status && data.status.value,
                        activationDate: toDate(data.activationDate || (data.timeline && data.timeline.activatedOnDate))
                    };
                }, function (response) {
                    scope.customer.loading = false;
                    scope.customer.error = extractMessages(response && response.data);
                });
                resourceFactory.clientResource.getAllClientDocuments({clientId: clientId, anotherresource: 'identifiers'}, function (data) {
                    scope.customer.identifiers = data || [];
                });
                resourceFactory.clientAccountResource.get({clientId: clientId}, function (data) {
                    scope.customer.loans = _.filter(data.loanAccounts || [], function (l) {
                        return l.status && (l.status.active || l.status.pendingApproval || l.status.waitingForDisbursal);
                    });
                });
            }

            if (routeClientId) {
                loadCustomer(routeClientId);
            }

            scope.pickCustomer = function (item) {
                if (item && item.id) {
                    location.path('/onboarding/client/' + item.id);
                }
            };
            scope.customerHasArrears = function () {
                return _.some(scope.customer.loans, function (l) {
                    return l.inArrears;
                });
            };

            function borrowerId() {
                return scope.mode === 'existing' ? (scope.customer.data && scope.customer.data.id) : null;
            }

            function borrowerOfficeId() {
                return scope.mode === 'existing' ? (scope.customer.data && scope.customer.data.officeId) : scope.ob.client.officeId;
            }

            function borrowerStaffId() {
                return scope.mode === 'existing' ? (scope.customer.data && scope.customer.data.staffId) : scope.ob.client.staffId;
            }

            function borrowerActivationDate() {
                return scope.mode === 'existing' ? (scope.customer.data && scope.customer.data.activationDate) : scope.ob.client.activationDate;
            }

            // new guarantor/co-borrower clients: activated with the borrower (new customer) or today (existing customer)
            function partyActivationDate() {
                return scope.mode === 'existing' ? startOfDay(new Date()) : scope.ob.client.activationDate;
            }

            // ------------------------------------------------------------------ geography (living & birth village)
            scope.onProvinceChange = function (geo, keep) {
                if (!keep) {
                    geo.districtId = null;
                    geo.communeId = null;
                    geo.villageId = null;
                    geo.communes = [];
                    geo.villages = [];
                }
                geo.districts = [];
                if (geo.provinceId) {
                    resourceFactory.districtResource.getByProvince({provinceId: geo.provinceId}, function (data) {
                        geo.districts = data;
                    });
                }
            };
            scope.onDistrictChange = function (geo, keep) {
                if (!keep) {
                    geo.communeId = null;
                    geo.villageId = null;
                    geo.villages = [];
                }
                geo.communes = [];
                if (geo.districtId) {
                    resourceFactory.communeResource.getByDistrict({districtId: geo.districtId}, function (data) {
                        geo.communes = data;
                    });
                }
            };
            scope.onCommuneChange = function (geo, keep) {
                if (!keep) {
                    geo.villageId = null;
                }
                geo.villages = [];
                if (geo.communeId) {
                    resourceFactory.villageResource.getByCommune({communeId: geo.communeId}, function (data) {
                        geo.villages = data;
                    });
                }
            };
            scope.clearGeo = function (geo) {
                angular.extend(geo, emptyGeo());
            };

            function reloadGeo(geo) {
                scope.onProvinceChange(geo, true);
                scope.onDistrictChange(geo, true);
                scope.onCommuneChange(geo, true);
            }

            // ------------------------------------------------------------------ identifiers
            scope.addIdentifier = function () {
                scope.ob.identifiers.push({documentTypeId: null, documentKey: '', description: '', status: 'Active'});
            };
            scope.removeIdentifier = function (index) {
                scope.ob.identifiers.splice(index, 1);
                // keep files aligned with their rows
                var files = {};
                _.each(scope.files, function (file, i) {
                    i = parseInt(i, 10);
                    if (i < index) {
                        files[i] = file;
                    } else if (i > index) {
                        files[i - 1] = file;
                    }
                });
                scope.files = files;
            };
            scope.setFile = function (index, file) {
                if (file) {
                    scope.files[index] = file;
                } else {
                    delete scope.files[index];
                }
            };

            // ------------------------------------------------------------------ collateral (per-loan pawned items)
            scope.addCollateral = function () {
                scope.ob.collaterals.push({
                    collateralTypeId: null, bookingAmount: null, evaluationAmount: null,
                    issuedOnDate: scope.ob.loan.expectedDisbursementDate || new Date(), expiredOnDate: null, description: ''
                });
            };
            scope.removeCollateral = function (index) {
                scope.ob.collaterals.splice(index, 1);
            };
            scope.collateralType = function (row) {
                return findById(scope.opt.collateralTypes, row.collateralTypeId);
            };
            scope.collateralTotal = function (field) {
                return _.reduce(scope.ob.collaterals, function (sum, row) {
                    return sum + (num(row[field]) || 0);
                }, 0);
            };

            // ------------------------------------------------------------------ guarantors & co-borrowers
            function newParty() {
                return {
                    mode: 'existing', client: null,
                    firstname: '', lastname: '', genderId: null, dateOfBirth: null, mobileNo: '', idTypeId: null, idNumber: ''
                };
            }

            scope.addParty = function (list) {
                scope.ob[list].push(newParty());
            };
            scope.removeParty = function (list, index) {
                scope.ob[list].splice(index, 1);
            };
            // active customers matching name, account number, external id or mobile; never the borrower
            scope.searchClients = function (value) {
                var deferred = $q.defer();
                resourceFactory.globalSearch.search({query: value, resource: 'clients', exactMatch: false}, function (data) {
                    var found = _.filter(data || [], function (r) {
                        return r.entityType === 'CLIENT' && r.entityStatus && r.entityStatus.id === CLIENT_STATUS_ACTIVE && r.entityId !== borrowerId();
                    });
                    // keep only what the wizard needs, so the draft stays small
                    deferred.resolve(_.map(found, function (r) {
                        return {id: r.entityId, displayName: r.entityName, accountNo: r.entityAccountNo, mobileNo: r.entityMobileNo, officeName: r.parentName};
                    }));
                }, function () {
                    deferred.resolve([]);
                });
                return deferred.promise;
            };
            scope.partyName = function (row) {
                if (row.mode === 'existing') {
                    return row.client ? row.client.displayName : '';
                }
                return ((row.firstname || '') + ' ' + (row.lastname || '')).trim();
            };

            // ------------------------------------------------------------------ loan terms
            scope.loanProductChange = function (productId, keepValues) {
                if (!productId) {
                    scope.loanTemplate = null;
                    return;
                }
                var params = {resourceType: 'template', templateType: 'individual', activeOnly: 'true', productId: productId};
                if (borrowerId()) {
                    params.clientId = borrowerId();
                }
                resourceFactory.loanResource.get(params, function (data) {
                    scope.loanTemplate = data;
                    scope.opt.chargeOptions = _.filter(data.chargeOptions || [], function (c) {
                        return !c.chargeTimeType || c.chargeTimeType.id !== ON_DEMAND_CHARGE_TIME;
                    });
                    if (!keepValues) {
                        applyProductDefaults(data);
                    }
                });
            };

            function applyProductDefaults(info) {
                var l = scope.ob.loan;
                l.productId = info.loanProductId;
                l.fundId = info.fundId;
                l.principal = info.principal;
                l.loanTermFrequency = info.termFrequency;
                l.loanTermFrequencyType = info.termPeriodFrequencyType && info.termPeriodFrequencyType.id;
                l.numberOfRepayments = info.numberOfRepayments;
                l.repaymentEvery = info.repaymentEvery;
                l.repaymentFrequencyType = info.repaymentFrequencyType && info.repaymentFrequencyType.id;
                l.interestRatePerPeriod = info.interestRatePerPeriod;
                l.interestType = info.interestType && info.interestType.id;
                l.amortizationType = info.amortizationType && info.amortizationType.id;
                l.isEqualAmortization = !!info.isEqualAmortization;
                l.interestCalculationPeriodType = info.interestCalculationPeriodType && info.interestCalculationPeriodType.id;
                l.allowPartialPeriodInterestCalcualtion = info.allowPartialPeriodInterestCalcualtion;
                l.transactionProcessingStrategyId = info.transactionProcessingStrategyId;
                l.graceOnPrincipalPayment = info.graceOnPrincipalPayment;
                l.graceOnInterestPayment = info.graceOnInterestPayment;
                l.graceOnInterestCharged = info.graceOnInterestCharged;
                l.graceOnArrearsAgeing = info.graceOnArrearsAgeing;
                l.inArrearsTolerance = info.inArrearsTolerance;
                l.fixedEmiAmount = info.fixedEmiAmount;
                l.maxOutstandingLoanBalance = info.maxOutstandingLoanBalance;
                l.balloonPayment = null;
                l.charges = _.map(_.filter(info.charges || [], function (c) {
                    return !c.chargeTimeType || c.chargeTimeType.id !== ON_DEMAND_CHARGE_TIME;
                }), function (c) {
                    return {chargeId: c.chargeId, name: c.name, amount: c.amount, chargeTimeType: c.chargeTimeType, dueDate: c.dueDate ? new Date(c.dueDate) : null};
                });
                scope.applyInterestTypeRules();
            }

            // Same interest-type side effects as the existing loan application screen (fork-specific methods 3-6).
            scope.applyInterestTypeRules = function () {
                var l = scope.ob.loan;
                switch (parseInt(l.interestType, 10)) {
                    case 5: // AMORTIZATION
                    case 6: // AMORTIZATION_FEE (annuity fee)
                        l.isEqualAmortization = true;
                        l.amortizationType = 1;
                        l.graceOnPrincipalPayment = null;
                        break;
                    case 3: // BALLOON: principal at the end
                        l.graceOnPrincipalPayment = (num(l.loanTermFrequency) || 1) - 1;
                        break;
                    case 4: // SEMI_BALLOON
                        l.graceOnPrincipalPayment = null;
                        break;
                    default:
                        break;
                }
            };

            scope.canOverride = function (attribute) {
                var p = scope.loanTemplate && scope.loanTemplate.product;
                return !!(p && p.allowAttributeOverrides && p.allowAttributeOverrides[attribute]);
            };

            scope.addCharge = function (chargeId) {
                if (!chargeId) {
                    return;
                }
                resourceFactory.chargeResource.get({chargeId: chargeId, template: 'true'}, function (data) {
                    scope.ob.loan.charges.push({chargeId: data.id, name: data.name, amount: data.amount, chargeTimeType: data.chargeTimeType, dueDate: null});
                });
                scope.ui.newChargeId = null;
            };
            scope.removeCharge = function (index) {
                scope.ob.loan.charges.splice(index, 1);
            };
            scope.needsDueDate = function (charge) {
                return charge.chargeTimeType && charge.chargeTimeType.id === SPECIFIED_DUE_DATE_CHARGE_TIME;
            };

            scope.productLimits = function () {
                var p = scope.loanTemplate && scope.loanTemplate.product;
                return p ? {min: p.minPrincipal, max: p.maxPrincipal} : {};
            };

            // ------------------------------------------------------------------ payload builders
            function buildClientPayload() {
                var c = scope.ob.client;
                var p = {
                    officeId: c.officeId,
                    legalFormId: c.legalFormId,
                    active: true,
                    activationDate: fmt(c.activationDate),
                    submittedOnDate: fmt(c.activationDate),
                    locale: scope.optlang.code,
                    dateFormat: scope.df
                };
                if (c.legalFormId == 1) {
                    p.firstname = c.firstname;
                    if (c.middlename) {
                        p.middlename = c.middlename;
                    }
                    p.lastname = c.lastname;
                } else {
                    p.fullname = c.fullname;
                }
                _.each(['staffId', 'genderId', 'clientTypeId', 'clientClassificationId'], function (k) {
                    if (c[k]) {
                        p[k] = c[k];
                    }
                });
                _.each(['mobileNo', 'externalId'], function (k) {
                    if (c[k]) {
                        p[k] = c[k];
                    }
                });
                if (c.dateOfBirth) {
                    p.dateOfBirth = fmt(c.dateOfBirth);
                }
                if (scope.ob.living.villageId) {
                    p.villageId = scope.ob.living.villageId;
                }
                if (scope.ob.birth.villageId) {
                    p.birthVillageId = scope.ob.birth.villageId;
                }
                if (scope.clientTemplate && scope.clientTemplate.isAddressEnabled) {
                    var a = angular.copy(c.address || {});
                    a.isActive = true;
                    p.address = [a];
                }
                return p;
            }

            function buildPartyClientPayload(row) {
                var p = {
                    officeId: borrowerOfficeId(),
                    legalFormId: 1,
                    firstname: row.firstname,
                    lastname: row.lastname,
                    active: true,
                    activationDate: fmt(partyActivationDate()),
                    submittedOnDate: fmt(partyActivationDate()),
                    locale: scope.optlang.code,
                    dateFormat: scope.df
                };
                if (borrowerStaffId()) {
                    p.staffId = borrowerStaffId();
                }
                if (row.genderId) {
                    p.genderId = row.genderId;
                }
                if (row.mobileNo) {
                    p.mobileNo = row.mobileNo;
                }
                if (row.dateOfBirth) {
                    p.dateOfBirth = fmt(row.dateOfBirth);
                }
                return p;
            }

            function buildCollateralPayload(row) {
                var p = {
                    collateralTypeId: row.collateralTypeId,
                    bookingAmount: row.bookingAmount,
                    evaluationAmount: row.evaluationAmount,
                    issuedOnDate: fmt(row.issuedOnDate),
                    locale: scope.optlang.code,
                    dateFormat: scope.df
                };
                if (row.expiredOnDate) {
                    p.expiredOnDate = fmt(row.expiredOnDate);
                }
                if (row.description) {
                    p.description = row.description;
                }
                return p;
            }

            function buildLoanPayload() {
                var l = scope.ob.loan;
                var p = {
                    loanType: 'individual',
                    productId: l.productId,
                    principal: l.principal,
                    loanTermFrequency: l.loanTermFrequency,
                    loanTermFrequencyType: l.loanTermFrequencyType,
                    numberOfRepayments: l.numberOfRepayments,
                    repaymentEvery: l.repaymentEvery,
                    repaymentFrequencyType: l.repaymentFrequencyType,
                    interestRatePerPeriod: l.interestRatePerPeriod,
                    interestType: l.interestType,
                    amortizationType: l.amortizationType,
                    isEqualAmortization: !!l.isEqualAmortization,
                    interestCalculationPeriodType: l.interestCalculationPeriodType,
                    transactionProcessingStrategyId: l.transactionProcessingStrategyId,
                    expectedDisbursementDate: fmt(l.expectedDisbursementDate),
                    submittedOnDate: fmt(l.submittedOnDate),
                    locale: scope.optlang.code,
                    dateFormat: scope.df
                };
                _.each(['fundId', 'graceOnPrincipalPayment', 'graceOnInterestPayment', 'graceOnInterestCharged', 'graceOnArrearsAgeing',
                    'inArrearsTolerance', 'fixedEmiAmount', 'maxOutstandingLoanBalance'], function (k) {
                    if (l[k] !== null && l[k] !== undefined && l[k] !== '') {
                        p[k] = l[k];
                    }
                });
                if (l.interestCalculationPeriodType == 0) {
                    p.allowPartialPeriodInterestCalcualtion = false;
                } else if (l.allowPartialPeriodInterestCalcualtion !== undefined) {
                    p.allowPartialPeriodInterestCalcualtion = l.allowPartialPeriodInterestCalcualtion;
                }
                if (l.interestType == 4 && l.balloonPayment) {
                    p.balloonPayment = l.balloonPayment;
                }
                if (l.repaymentsStartingFromDate) {
                    p.repaymentsStartingFromDate = fmt(l.repaymentsStartingFromDate);
                }
                var info = scope.loanTemplate;
                if (info && info.isInterestRecalculationEnabled && info.interestRecalculationData) {
                    if (info.interestRecalculationData.recalculationRestFrequencyDate) {
                        p.recalculationRestFrequencyDate = fmt(new Date(info.interestRecalculationData.recalculationRestFrequencyDate));
                    }
                    if (info.interestRecalculationData.recalculationCompoundingFrequencyDate) {
                        p.recalculationCompoundingFrequencyDate = fmt(new Date(info.interestRecalculationData.recalculationCompoundingFrequencyDate));
                    }
                }
                if (l.charges.length > 0) {
                    p.charges = _.map(l.charges, function (c) {
                        var charge = {chargeId: c.chargeId, amount: c.amount};
                        if (c.dueDate) {
                            charge.dueDate = fmt(c.dueDate);
                        }
                        return charge;
                    });
                }
                return p;
            }

            function buildBatch() {
                var requests = [];
                var meta = {};
                var nextId = 0;

                function add(relativeUrl, body, reference, info) {
                    nextId++;
                    var request = {requestId: nextId, relativeUrl: relativeUrl, method: 'POST', body: JSON.stringify(body)};
                    if (reference) {
                        request.reference = reference;
                    }
                    requests.push(request);
                    meta[nextId] = info;
                    return nextId;
                }

                var existing = scope.mode === 'existing';
                // existing customer: no client request; identifiers are stand-alone requests against the known id
                var clientReq = existing ? null : add('clients', buildClientPayload(), null, {step: 'client', kind: 'client'});
                var identifierUrl = existing ? 'clients/' + borrowerId() + '/identifiers' : 'clients/$.clientId/identifiers';

                _.each(scope.ob.identifiers, function (identifier, i) {
                    add(identifierUrl, {
                        documentTypeId: identifier.documentTypeId,
                        documentKey: identifier.documentKey,
                        description: identifier.description || undefined,
                        status: identifier.status || 'Active'
                    }, clientReq, {step: 'identifiers', kind: 'identifier', index: i});
                });

                // $ref[n] may only point at an ancestor, so everything after the borrower is one chain:
                // borrower -> new guarantor/co-borrower clients -> loan -> collaterals -> guarantors -> co-borrowers -> approve -> disburse
                var parent = clientReq;
                var partyReqs = {};
                _.each(PARTY_LISTS, function (list) {
                    _.each(scope.ob[list], function (row, i) {
                        if (row.mode !== 'new') {
                            return;
                        }
                        parent = add('clients', buildPartyClientPayload(row), parent, {step: 'parties', kind: list, index: i});
                        partyReqs[list + i] = parent;
                        if (row.idTypeId && row.idNumber) {
                            // leaf off the new client: does not break the chain
                            add('clients/$.clientId/identifiers', {documentTypeId: row.idTypeId, documentKey: row.idNumber, status: 'Active'},
                                parent, {step: 'parties', kind: list, index: i});
                        }
                    });
                });

                function partyClientId(list, row, i) {
                    return row.mode === 'new' ? '$ref[' + partyReqs[list + i] + '].clientId' : row.client.id;
                }

                var loanBody = buildLoanPayload();
                loanBody.clientId = existing ? borrowerId() : '$ref[' + clientReq + '].clientId';
                // the customer's officer becomes the loan officer, but only if they are allowed to be one
                if (existing && borrowerStaffId() && scope.loanTemplate && findById(scope.loanTemplate.loanOfficerOptions, borrowerStaffId())) {
                    loanBody.loanOfficerId = borrowerStaffId();
                }
                var loanReq = add('loans', loanBody, parent, {step: 'loan', kind: 'loan'});
                parent = loanReq;
                var loanUrl = 'loans/$ref[' + loanReq + '].loanId';

                // per-loan collateral can only be added while the loan is still pending approval, i.e. before approve
                _.each(scope.ob.collaterals, function (row, i) {
                    parent = add(loanUrl + '/collaterals', buildCollateralPayload(row), parent, {step: 'collateral', kind: 'collateral', index: i});
                });
                _.each(scope.ob.guarantors, function (row, i) {
                    parent = add(loanUrl + '/guarantors', {
                        guarantorTypeId: GUARANTOR_TYPE_CUSTOMER,
                        entityId: partyClientId('guarantors', row, i),
                        locale: scope.optlang.code,
                        dateFormat: scope.df
                    }, parent, {step: 'parties', kind: 'guarantors', index: i});
                });
                _.each(scope.ob.coBorrowers, function (row, i) {
                    parent = add(loanUrl + '/coborrowers', {
                        clientId: partyClientId('coBorrowers', row, i),
                        locale: scope.optlang.code,
                        dateFormat: scope.df
                    }, parent, {step: 'parties', kind: 'coBorrowers', index: i});
                });

                var a = scope.ob.approval;
                if (scope.showApprovalStep() && a.approve) {
                    var approveReq = add(loanUrl + '?command=approve', {
                        approvedOnDate: fmt(a.approvedOnDate),
                        approvedLoanAmount: a.approvedLoanAmount,
                        expectedDisbursementDate: fmt(scope.ob.loan.expectedDisbursementDate),
                        note: a.note || undefined,
                        locale: scope.optlang.code,
                        dateFormat: scope.df
                    }, parent, {step: 'approval', kind: 'approve'});

                    if (scope.canDisburse() && a.disburse) {
                        var disburseBody = {
                            actualDisbursementDate: fmt(a.actualDisbursementDate),
                            transactionAmount: a.transactionAmount || a.approvedLoanAmount,
                            note: a.note || undefined,
                            locale: scope.optlang.code,
                            dateFormat: scope.df
                        };
                        // payment type is optional: an empty selection is disbursed as cash
                        var cash = scope.cashPaymentType();
                        var paymentTypeId = a.paymentTypeId || (cash && cash.id);
                        if (paymentTypeId) {
                            disburseBody.paymentTypeId = paymentTypeId;
                        }
                        add(loanUrl + '?command=disburse', disburseBody, approveReq, {step: 'approval', kind: 'disburse'});
                    }
                }

                return {requests: requests, meta: meta, clientReq: clientReq, loanReq: loanReq};
            }

            // default disbursement payment type: the one named "Cash", else any flagged as a cash payment
            scope.cashPaymentType = function () {
                var types = scope.opt.paymentTypes || [];
                return _.find(types, function (p) {
                    return p.name && p.name.trim().toLowerCase() === 'cash';
                }) || _.find(types, function (p) {
                    return p.isCashPayment === true;
                }) || _.find(types, function (p) {
                    return p.name && /cash/i.test(p.name);
                }) || null;
            };

            scope.canDisburse = function () {
                return scope.can.disburse && !scope.mc.disburse;
            };

            // ------------------------------------------------------------------ schedule preview
            scope.previewSchedule = function () {
                var payload = buildLoanPayload();
                var hash = angular.toJson(payload);
                if (scope.schedule.data && scope.schedule.payloadHash === hash) {
                    return;
                }
                scope.schedule.loading = true;
                scope.schedule.error = null;
                // no clientId yet: the backend allows a preview before the client exists
                resourceFactory.loanResource.save({command: 'calculateLoanSchedule'}, payload, function (data) {
                    scope.schedule.data = data;
                    scope.schedule.payloadHash = hash;
                    scope.schedule.loading = false;
                }, function (response) {
                    scope.schedule.loading = false;
                    scope.schedule.data = null;
                    scope.schedule.error = extractMessages(response && response.data);
                });
            };

            scope.scheduleIsCurrent = function () {
                return !!scope.schedule.data && scope.schedule.payloadHash === angular.toJson(buildLoanPayload());
            };

            // ------------------------------------------------------------------ validation (mirrors server rules)
            function validateStep(key) {
                var e = [];
                var c = scope.ob.client;
                var l = scope.ob.loan;
                var a = scope.ob.approval;
                if (key === 'customer') {
                    if (!scope.customer.data) {
                        e.push('validation.msg.onboarding.customer.required');
                    } else if (!scope.customer.data.active) {
                        e.push('validation.msg.onboarding.customer.notactive');
                    }
                }
                if (key === 'client') {
                    if (!c.officeId) {
                        e.push('validation.msg.onboarding.office.required');
                    }
                    if (!c.legalFormId) {
                        e.push('validation.msg.onboarding.legalform.required');
                    }
                    if (c.legalFormId == 1 && (!c.firstname || !c.lastname)) {
                        e.push('validation.msg.onboarding.name.required');
                    }
                    if (c.legalFormId != 1 && !c.fullname) {
                        e.push('validation.msg.onboarding.fullname.required');
                    }
                    if (!c.activationDate) {
                        e.push('validation.msg.onboarding.activationdate.required');
                    } else if (isFuture(c.activationDate)) {
                        e.push('validation.msg.onboarding.activationdate.future');
                    }
                    if (c.dateOfBirth && (isFuture(c.dateOfBirth) || !isBefore(c.dateOfBirth, c.activationDate))) {
                        e.push('validation.msg.onboarding.dateofbirth.invalid');
                    }
                }
                if (key === 'identifiers') {
                    var types = [];
                    var onFile = scope.mode === 'existing' ? _.map(scope.customer.identifiers, function (i) {
                        return i.documentType && i.documentType.id;
                    }) : [];
                    _.each(scope.ob.identifiers, function (row) {
                        if (!row.documentTypeId || !row.documentKey) {
                            e.push('validation.msg.onboarding.identifier.incomplete');
                        } else if (_.contains(onFile, row.documentTypeId)) {
                            e.push('validation.msg.onboarding.identifier.exists');
                        } else if (_.contains(types, row.documentTypeId)) {
                            e.push('validation.msg.onboarding.identifier.duplicate.type');
                        }
                        types.push(row.documentTypeId);
                    });
                }
                if (key === 'collateral') {
                    _.each(scope.ob.collaterals, function (row) {
                        if (!row.collateralTypeId || !(num(row.bookingAmount) > 0) || !(num(row.evaluationAmount) > 0) || !row.issuedOnDate) {
                            e.push('validation.msg.onboarding.collateral.incomplete');
                        }
                        if (row.expiredOnDate && isBefore(row.expiredOnDate, row.issuedOnDate)) {
                            e.push('validation.msg.onboarding.collateral.expiry.before.issue');
                        }
                    });
                }
                if (key === 'parties') {
                    var seen = [];
                    _.each(PARTY_LISTS, function (list) {
                        _.each(scope.ob[list], function (row) {
                            if (row.mode === 'existing') {
                                if (!row.client || !row.client.id) {
                                    e.push('validation.msg.onboarding.party.incomplete');
                                } else if (row.client.id === borrowerId()) {
                                    e.push('validation.msg.onboarding.party.isborrower');
                                } else if (_.contains(seen, row.client.id)) {
                                    e.push('validation.msg.onboarding.party.duplicate');
                                } else {
                                    seen.push(row.client.id);
                                }
                            } else {
                                if (!row.firstname || !row.lastname) {
                                    e.push('validation.msg.onboarding.party.incomplete');
                                }
                                if (!!row.idTypeId !== !!row.idNumber) {
                                    e.push('validation.msg.onboarding.party.id.incomplete');
                                }
                                if (row.dateOfBirth && (isFuture(row.dateOfBirth) || !isBefore(row.dateOfBirth, partyActivationDate()))) {
                                    e.push('validation.msg.onboarding.dateofbirth.invalid');
                                }
                            }
                        });
                    });
                }
                if (key === 'loan') {
                    var principal = num(l.principal);
                    var limits = scope.productLimits();
                    if (!l.productId || !scope.loanTemplate) {
                        e.push('validation.msg.onboarding.product.required');
                    } else if (scope.loanTemplate.multiDisburseLoan) {
                        e.push('validation.msg.onboarding.product.multidisburse.unsupported');
                    }
                    if (!(principal > 0)) {
                        e.push('validation.msg.onboarding.principal.required');
                    } else {
                        if (limits.min != null && principal < limits.min) {
                            e.push('validation.msg.onboarding.principal.below.min');
                        }
                        if (limits.max != null && principal > limits.max) {
                            e.push('validation.msg.onboarding.principal.above.max');
                        }
                    }
                    if (!(num(l.numberOfRepayments) > 0) || !(num(l.loanTermFrequency) > 0) || !(num(l.repaymentEvery) > 0)) {
                        e.push('validation.msg.onboarding.terms.required');
                    }
                    if (l.interestRatePerPeriod === null || l.interestRatePerPeriod === undefined || l.interestRatePerPeriod === '') {
                        e.push('validation.msg.onboarding.interestrate.required');
                    }
                    if (!l.submittedOnDate || !l.expectedDisbursementDate) {
                        e.push('validation.msg.onboarding.loandates.required');
                    } else {
                        if (isBefore(l.submittedOnDate, borrowerActivationDate())) {
                            e.push('validation.msg.onboarding.submitted.before.activation');
                        }
                        if (isFuture(l.submittedOnDate)) {
                            e.push('validation.msg.onboarding.submitted.future');
                        }
                        if (isBefore(l.expectedDisbursementDate, l.submittedOnDate)) {
                            e.push('validation.msg.onboarding.disbursement.before.submitted');
                        }
                    }
                    _.each(l.charges, function (charge) {
                        if (scope.needsDueDate(charge) && !charge.dueDate) {
                            e.push('validation.msg.onboarding.charge.duedate.required');
                        }
                    });
                }
                if (key === 'schedule') {
                    if (!scope.scheduleIsCurrent()) {
                        e.push('validation.msg.onboarding.schedule.required');
                    }
                }
                if (key === 'approval' && a.approve) {
                    if (!a.approvedOnDate || isFuture(a.approvedOnDate) || isBefore(a.approvedOnDate, l.submittedOnDate)) {
                        e.push('validation.msg.onboarding.approvedon.invalid');
                    }
                    if (isBefore(l.expectedDisbursementDate, a.approvedOnDate)) {
                        e.push('validation.msg.onboarding.expecteddisbursement.before.approval');
                    }
                    if (!(num(a.approvedLoanAmount) > 0) || num(a.approvedLoanAmount) > num(l.principal)) {
                        e.push('validation.msg.onboarding.approvedamount.invalid');
                    }
                    if (a.disburse) {
                        var amount = num(a.transactionAmount || a.approvedLoanAmount);
                        if (!a.actualDisbursementDate || isFuture(a.actualDisbursementDate) || isBefore(a.actualDisbursementDate, a.approvedOnDate)) {
                            e.push('validation.msg.onboarding.disbursedon.invalid');
                        }
                        if (!(amount > 0) || amount > num(a.approvedLoanAmount)) {
                            e.push('validation.msg.onboarding.disbursementamount.invalid');
                        }
                    }
                }
                return _.uniq(e);
            }

            scope.$watch('ob.approval.approve', function (approve) {
                if (!approve) {
                    scope.ob.approval.disburse = false;
                }
            });

            // ------------------------------------------------------------------ submit
            scope.submit = function () {
                // re-validate every step: the draft may have been edited out of order
                var firstInvalid = null;
                _.each(scope.steps(), function (s) {
                    if (!firstInvalid && validateStep(s.key).length > 0) {
                        firstInvalid = s.key;
                    }
                });
                if (firstInvalid) {
                    scope.goTo(firstInvalid);
                    scope.ui.errors = validateStep(firstInvalid);
                    return;
                }
                if (scope.mcBlocked() || !scope.can.create) {
                    return;
                }

                var batch = buildBatch();
                scope.ui.submitting = true;
                scope.ui.errors = [];
                resourceFactory.batchResource.post({enclosingTransaction: true}, batch.requests, function (responses) {
                    scope.ui.submitting = false;
                    handleBatchResponse(batch, responses);
                }, function (response) {
                    scope.ui.submitting = false;
                    scope.ui.serverError = {step: null, messages: extractMessages(response && response.data)};
                });
            };

            function handleBatchResponse(batch, responses) {
                var failed = _.find(responses, function (r) {
                    return r.statusCode !== 200;
                });
                if (!failed && responses.length === batch.requests.length) {
                    onCommitted(batch, responses);
                    return;
                }

                // Enclosing-transaction failures come back as one response whose body embeds the first failed request.
                var culprit = failed;
                if (failed && typeof failed.body === 'string' && failed.body.indexOf(ROLLBACK_PREFIX) === 0) {
                    try {
                        culprit = JSON.parse(failed.body.substring(failed.body.indexOf('\n') + 1));
                    } catch (ignore) {
                        culprit = failed;
                    }
                }
                var info = culprit && culprit.requestId ? batch.meta[culprit.requestId] : null;
                var body = culprit && culprit.body;
                if (typeof body === 'string') {
                    try {
                        body = JSON.parse(body);
                    } catch (ignore) {
                        body = {defaultUserMessage: body};
                    }
                }
                scope.ui.serverError = {
                    step: info ? info.step : null,
                    kind: info ? info.kind : null,
                    index: info ? info.index : null,
                    messages: extractMessages(body)
                };
                if (info) {
                    scope.ob.stepKey = info.step;
                    window.scrollTo(0, 0);
                }
            }

            function extractMessages(body) {
                if (!body) {
                    return [{text: 'error.msg.onboarding.unexpected'}];
                }
                if (body.errors && body.errors.length > 0) {
                    return _.map(body.errors, function (err) {
                        return {
                            code: err.userMessageGlobalisationCode,
                            text: err.defaultUserMessage || err.developerMessage,
                            field: err.parameterName,
                            args: err.args
                        };
                    });
                }
                return [{code: body.userMessageGlobalisationCode, text: body.defaultUserMessage || body.developerMessage || body.message}];
            }

            scope.dismissServerError = function () {
                scope.ui.serverError = null;
            };

            function bodyOf(responses, requestId) {
                var r = _.find(responses, {requestId: requestId});
                try {
                    return r ? JSON.parse(r.body) : {};
                } catch (ignore) {
                    return {};
                }
            }

            function onCommitted(batch, responses) {
                var client = bodyOf(responses, batch.clientReq);
                var loan = bodyOf(responses, batch.loanReq);
                scope.ui.result = {
                    clientId: scope.mode === 'existing' ? borrowerId() : (client.clientId || client.resourceId),
                    loanId: loan.loanId || loan.resourceId,
                    approved: scope.ob.approval.approve && scope.showApprovalStep(),
                    disbursed: scope.ob.approval.approve && scope.ob.approval.disburse && scope.canDisburse()
                };
                scope.ui.serverError = null;
                clearDraft();

                // identifier documents are uploaded after the commit (multipart cannot join the transaction)
                scope.ui.uploads = [];
                _.each(batch.meta, function (info, requestId) {
                    if (info.kind === 'identifier' && scope.files[info.index]) {
                        var identifierId = bodyOf(responses, parseInt(requestId, 10)).resourceId;
                        scope.ui.uploads.push({
                            identifierId: identifierId,
                            file: scope.files[info.index],
                            label: scope.ob.identifiers[info.index].documentKey,
                            status: 'pending'
                        });
                    }
                });
                _.each(scope.ui.uploads, scope.upload);
            }

            scope.upload = function (item) {
                item.status = 'uploading';
                Upload.upload({
                    url: rootScope.hostUrl + API_VERSION + '/client_identifiers/' + item.identifierId + '/documents',
                    data: {name: item.file.name, description: item.label},
                    file: item.file
                }).then(function () {
                    item.status = 'done';
                }, function () {
                    item.status = 'failed';
                });
            };

            scope.startOver = function () {
                clearDraft();
                scope.ob = newState();
                scope.files = {};
                scope.loanTemplate = null;
                scope.schedule = {data: null, payloadHash: null, loading: false, error: null};
                scope.ui = {errors: [], submitting: false, draftRestored: false, result: null, uploads: [], open: {}};
                if (scope.opt.offices.length > 0) {
                    scope.ob.client.officeId = scope.opt.offices[0].id;
                }
            };

            scope.goToClient = function () {
                location.path('/viewclient/' + scope.ui.result.clientId);
            };
            scope.goToLoan = function () {
                location.path('/viewloanaccount/' + scope.ui.result.loanId);
            };

            // ------------------------------------------------------------------ draft (per-browser convenience only)
            var DATE_PATHS = [['client', 'dateOfBirth'], ['client', 'activationDate'], ['loan', 'submittedOnDate'],
                ['loan', 'expectedDisbursementDate'], ['loan', 'repaymentsStartingFromDate'], ['approval', 'approvedOnDate'],
                ['approval', 'actualDisbursementDate']];

            // new customer: one draft; existing customer: one draft per customer; chooser/search screen: none
            function draftKey() {
                if (scope.mode === 'existing') {
                    return routeClientId ? DRAFT_KEY + '.client.' + routeClientId : null;
                }
                return scope.mode === 'new' ? DRAFT_KEY : null;
            }

            function saveDraft() {
                if (scope.ui.result || !draftKey()) {
                    return;
                }
                try {
                    var copy = angular.copy(scope.ob);
                    _.each(['living', 'birth'], function (k) {
                        copy[k].districts = [];
                        copy[k].communes = [];
                        copy[k].villages = [];
                    });
                    window.localStorage.setItem(draftKey(), angular.toJson(copy));
                } catch (ignore) {
                    // storage unavailable: the wizard still works, only the draft is not kept
                }
            }

            function clearDraft() {
                if (!draftKey()) {
                    return;
                }
                try {
                    window.localStorage.removeItem(draftKey());
                } catch (ignore) {
                    // ignore
                }
            }

            function restoreDraft() {
                var raw = null;
                if (!draftKey()) {
                    return;
                }
                try {
                    raw = window.localStorage.getItem(draftKey());
                } catch (ignore) {
                    return;
                }
                if (!raw) {
                    return;
                }
                try {
                    var draft = angular.fromJson(raw);
                    _.each(DATE_PATHS, function (path) {
                        var v = draft[path[0]] && draft[path[0]][path[1]];
                        if (v) {
                            draft[path[0]][path[1]] = new Date(v);
                        }
                    });
                    _.each(draft.loan && draft.loan.charges, function (c) {
                        if (c.dueDate) {
                            c.dueDate = new Date(c.dueDate);
                        }
                    });
                    _.each(draft.collaterals, function (row) {
                        _.each(['issuedOnDate', 'expiredOnDate'], function (k) {
                            if (row[k]) {
                                row[k] = new Date(row[k]);
                            }
                        });
                    });
                    _.each(PARTY_LISTS, function (list) {
                        _.each(draft[list], function (row) {
                            if (row.dateOfBirth) {
                                row.dateOfBirth = new Date(row.dateOfBirth);
                            }
                        });
                    });
                    scope.ob = angular.extend(newState(), draft);
                    // file inputs cannot be restored, and the schedule is always recalculated
                    scope.ui.draftRestored = true;
                    reloadGeo(scope.ob.living);
                    reloadGeo(scope.ob.birth);
                } catch (ignore) {
                    clearDraft();
                }
            }

            restoreDraft();

            var saveTimer = null;
            scope.$watch('ob', function () {
                if (saveTimer) {
                    clearTimeout(saveTimer);
                }
                saveTimer = setTimeout(saveDraft, 500);
            }, true);
            scope.$on('$destroy', function () {
                if (saveTimer) {
                    clearTimeout(saveTimer);
                }
            });
        }
    });
    mifosX.ng.application.controller('OnboardingWizardController', ['$scope', '$rootScope', 'ResourceFactory', '$location', 'dateFilter', 'API_VERSION', 'Upload', '$q', '$routeParams', mifosX.controllers.OnboardingWizardController]).run(function ($log) {
        $log.info("OnboardingWizardController initialized");
    });
}(mifosX.controllers || {}));
