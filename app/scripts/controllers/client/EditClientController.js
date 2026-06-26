(function (module) {
    mifosX.controllers = _.extend(module, {
        EditClientController: function (scope, routeParams, resourceFactory, location, http, dateFilter, API_VERSION, Upload, $rootScope) {
            scope.offices = [];
            scope.date = {};
            scope.restrictDate = new Date();
            scope.savingproducts = [];
            scope.clientId = routeParams.id;
            scope.showSavingOptions = 'false';
            scope.opensavingsproduct = 'false';
            scope.showNonPersonOptions = false;
            scope.clientPersonId = 1;

            // Geography – Living Address & Birth Address
            scope.living = { provinceId: null, districtId: null, communeId: null, villageId: null, districts: [], communes: [], villages: [] };
            scope.birth  = { provinceId: null, districtId: null, communeId: null, villageId: null, districts: [], communes: [], villages: [] };
            scope.geoProvinces = [];

            resourceFactory.provinceResource.getAllProvinces(function (data) {
                scope.geoProvinces = data;
            });

            scope.prefillGeoAddress = function (type, villageId) {
                resourceFactory.villageResource.get({ villageId: villageId }, function (village) {
                    scope[type].villageId = village.id;
                    resourceFactory.communeResource.get({ communeId: village.communeId }, function (commune) {
                        scope[type].communeId = commune.id;
                        resourceFactory.districtResource.get({ districtId: commune.districtId }, function (district) {
                            scope[type].districtId = district.id;
                            scope[type].provinceId = district.provinceId;
                            resourceFactory.districtResource.getByProvince({ provinceId: district.provinceId }, function (districts) {
                                scope[type].districts = districts;
                            });
                            resourceFactory.communeResource.getByDistrict({ districtId: district.id }, function (communes) {
                                scope[type].communes = communes;
                            });
                            resourceFactory.villageResource.getByCommune({ communeId: village.communeId }, function (villages) {
                                scope[type].villages = villages;
                            });
                        });
                    });
                });
            };

            scope.onLivingProvinceChange = function () {
                scope.living.districtId = null; scope.living.communeId = null; scope.living.villageId = null;
                scope.living.districts = []; scope.living.communes = []; scope.living.villages = [];
                if (scope.living.provinceId) {
                    resourceFactory.districtResource.getByProvince({ provinceId: scope.living.provinceId }, function (data) { scope.living.districts = data; });
                }
            };
            scope.onLivingDistrictChange = function () {
                scope.living.communeId = null; scope.living.villageId = null;
                scope.living.communes = []; scope.living.villages = [];
                if (scope.living.districtId) {
                    resourceFactory.communeResource.getByDistrict({ districtId: scope.living.districtId }, function (data) { scope.living.communes = data; });
                }
            };
            scope.onLivingCommuneChange = function () {
                scope.living.villageId = null; scope.living.villages = [];
                if (scope.living.communeId) {
                    resourceFactory.villageResource.getByCommune({ communeId: scope.living.communeId }, function (data) { scope.living.villages = data; });
                }
            };
            scope.clearLivingAddress = function () {
                scope.living.provinceId = null; scope.living.districtId = null; scope.living.communeId = null; scope.living.villageId = null;
                scope.living.districts = []; scope.living.communes = []; scope.living.villages = [];
            };

            scope.onBirthProvinceChange = function () {
                scope.birth.districtId = null; scope.birth.communeId = null; scope.birth.villageId = null;
                scope.birth.districts = []; scope.birth.communes = []; scope.birth.villages = [];
                if (scope.birth.provinceId) {
                    resourceFactory.districtResource.getByProvince({ provinceId: scope.birth.provinceId }, function (data) { scope.birth.districts = data; });
                }
            };
            scope.onBirthDistrictChange = function () {
                scope.birth.communeId = null; scope.birth.villageId = null;
                scope.birth.communes = []; scope.birth.villages = [];
                if (scope.birth.districtId) {
                    resourceFactory.communeResource.getByDistrict({ districtId: scope.birth.districtId }, function (data) { scope.birth.communes = data; });
                }
            };
            scope.onBirthCommuneChange = function () {
                scope.birth.villageId = null; scope.birth.villages = [];
                if (scope.birth.communeId) {
                    resourceFactory.villageResource.getByCommune({ communeId: scope.birth.communeId }, function (data) { scope.birth.villages = data; });
                }
            };
            scope.clearBirthAddress = function () {
                scope.birth.provinceId = null; scope.birth.districtId = null; scope.birth.communeId = null; scope.birth.villageId = null;
                scope.birth.districts = []; scope.birth.communes = []; scope.birth.villages = [];
            };

            resourceFactory.clientResource.get({clientId: routeParams.id, template:'true', staffInSelectedOfficeOnly:true}, function (data) {
                scope.offices = data.officeOptions;
                scope.staffs = data.staffOptions;
                scope.savingproducts = data.savingProductOptions;
                scope.genderOptions = data.genderOptions;
                scope.clienttypeOptions = data.clientTypeOptions;
                scope.clientClassificationOptions = data.clientClassificationOptions;
                scope.clientNonPersonConstitutionOptions = data.clientNonPersonConstitutionOptions;
                scope.clientNonPersonMainBusinessLineOptions = data.clientNonPersonMainBusinessLineOptions;
                scope.clientLegalFormOptions = data.clientLegalFormOptions;
                scope.officeId = data.officeId;
                scope.formData = {
                    firstname: data.firstname,
                    lastname: data.lastname,
                    middlename: data.middlename,
                    active: data.active,
                    accountNo: data.accountNo,
                    staffId: data.staffId,
                    externalId: data.externalId,
                    isStaff:data.isStaff,
                    mobileNo: data.mobileNo,
                    savingsProductId: data.savingsProductId,
                    genderId: data.gender.id,
                    fullname: data.fullname,
                    clientNonPersonDetails : {
                        incorpNumber: data.clientNonPersonDetails.incorpNumber,
                        remarks: data.clientNonPersonDetails.remarks
                    }
                };

                if(data.gender){
                    scope.formData.genderId = data.gender.id;
                }

                if(data.clientType){
                    scope.formData.clientTypeId = data.clientType.id;
                }

                if(data.clientClassification){
                    scope.formData.clientClassificationId = data.clientClassification.id;
                }

                if(data.legalForm){
                    scope.displayPersonOrNonPersonOptions(data.legalForm.id);
                    scope.formData.legalFormId = data.legalForm.id;
                }

                if(data.clientNonPersonDetails.constitution){
                    scope.formData.clientNonPersonDetails.constitutionId = data.clientNonPersonDetails.constitution.id;
                }

                if(data.clientNonPersonDetails.mainBusinessLine){
                    scope.formData.clientNonPersonDetails.mainBusinessLineId = data.clientNonPersonDetails.mainBusinessLine.id;
                }

                if (data.savingsProductId != null) {
                    scope.opensavingsproduct = 'true';
                    scope.showSavingOptions = 'true';
                } else if (data.savingProductOptions.length > 0) {
                    scope.showSavingOptions = 'true';
                }

                if (data.dateOfBirth) {
                    var dobDate = dateFilter(data.dateOfBirth, scope.df);
                    scope.date.dateOfBirth = new Date(dobDate);
                }

                if (data.clientNonPersonDetails.incorpValidityTillDate) {
                    var incorpValidityTillDate = dateFilter(data.clientNonPersonDetails.incorpValidityTillDate, scope.df);
                    scope.date.incorpValidityTillDate = new Date(incorpValidityTillDate);
                }

                var actDate = dateFilter(data.activationDate, scope.df);
                scope.date.activationDate = new Date(actDate);
                if (data.active) {
                    scope.choice = 1;
                    scope.showSavingOptions = 'false';
                    scope.opensavingsproduct = 'false';
                }

                if (data.timeline.submittedOnDate) {
                    var submittedOnDate = dateFilter(data.timeline.submittedOnDate, scope.df);
                    scope.date.submittedOnDate = new Date(submittedOnDate);
                }

                if (data.villageId) {
                    scope.prefillGeoAddress('living', data.villageId);
                }
                if (data.birthVillageId) {
                    scope.prefillGeoAddress('birth', data.birthVillageId);
                }

            });

            scope.displayPersonOrNonPersonOptions = function (legalFormId) {
                if(legalFormId == scope.clientPersonId || legalFormId == null) {
                    scope.showNonPersonOptions = false;
                }else {
                    scope.showNonPersonOptions = true;
                }
            };

            scope.submit = function () {
                this.formData.locale = scope.optlang.code;
                this.formData.dateFormat = scope.df;
                if (scope.choice === 1) {
                    if (scope.date.activationDate) {
                        this.formData.activationDate = dateFilter(scope.date.activationDate, scope.df);
                    }
                }
                if(scope.date.dateOfBirth){
                    this.formData.dateOfBirth = dateFilter(scope.date.dateOfBirth,  scope.df);
                }

                if(scope.date.submittedOnDate){
                    this.formData.submittedOnDate = dateFilter(scope.date.submittedOnDate,  scope.df);
                }

                if(scope.date.incorpValidityTillDate){
                    this.formData.clientNonPersonDetails.locale = scope.optlang.code;
                    this.formData.clientNonPersonDetails.dateFormat = scope.df;
                    this.formData.clientNonPersonDetails.incorpValidityTillDate = dateFilter(scope.date.incorpValidityTillDate,  scope.df);
                }

                if(this.formData.legalFormId == scope.clientPersonId || this.formData.legalFormId == null) {
                    delete this.formData.fullname;
                }else {
                    delete this.formData.firstname;
                    delete this.formData.middlename;
                    delete this.formData.lastname;
                }

                this.formData.villageId = scope.living.villageId || null;
                this.formData.birthVillageId = scope.birth.villageId || null;

                resourceFactory.clientResource.update({'clientId': routeParams.id}, this.formData, function (data) {
                    location.path('/viewclient/' + routeParams.id);
                });
            };
        }
    });
    mifosX.ng.application.controller('EditClientController', ['$scope', '$routeParams', 'ResourceFactory', '$location', '$http', 'dateFilter', 'API_VERSION', 'Upload', '$rootScope', mifosX.controllers.EditClientController]).run(function ($log) {
        $log.info("EditClientController initialized");
    });
}(mifosX.controllers || {}));
