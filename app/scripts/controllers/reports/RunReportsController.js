(function (module) {
    mifosX.controllers = _.extend(module, {

        // Unified report page for the Reports tab: builds the parameter form from the report's stretchy parameters and
        // renders the result with <jasper-report-viewer> (preview, PDF/Excel/Word downloads and print)
        RunReportsController: function (scope, routeParams, resourceFactory, dateFilter, $timeout) {
            scope.isCollapsed = false; //displays options div on startup
            scope.formData = {};
            scope.reportParams = [];
            scope.reportDateParams = [];
            scope.reportTextParams = [];
            scope.reqFields = [];
            scope.reportName = routeParams.name;
            // "(Pentaho)" rows were converted to Jasper; show them under the plain report name
            scope.displayName = scope.reportName.replace(/\s*\(Pentaho\)$/, '');
            scope.jasperParams = null;

            resourceFactory.runReportsResource.getReport({reportSource: 'FullParameterList', parameterType: true, R_reportListing: "'" + routeParams.name + "'"}, function (data) {

                for (var i in data.data) {
                    var temp = {
                        name: data.data[i].row[0],
                        variable: data.data[i].row[1],
                        label: data.data[i].row[2],
                        displayType: data.data[i].row[3],
                        formatType: data.data[i].row[4],
                        defaultVal: data.data[i].row[5],
                        selectOne: data.data[i].row[6],
                        selectAll: data.data[i].row[7],
                        parentParameterName: data.data[i].row[8],
                        inputName: "R_" + data.data[i].row[1] //model name
                    };
                    scope.reqFields.push(temp);
                    if (temp.displayType == 'select' && temp.parentParameterName == null) {
                        intializeParams(temp, {});
                    } else if (temp.displayType == 'date') {
                        scope.reportDateParams.push(temp);
                    } else if (temp.displayType == 'text') {
                        scope.reportTextParams.push(temp);
                    }
                }
                // Reports without visible parameters run straight away
                if (_.every(scope.reqFields, function (field) { return field.displayType == 'none'; })) {
                    scope.runReport();
                }
            });

            function getSuccuessFunction(paramData) {
                var successFunction = function (data) {
                    var selectData = [];
                    var isExistedRecord = false;
                    for (var i in data.data) {
                        selectData.push({id: data.data[i].row[0], name: data.data[i].row[1]});
                    }
                    for (var j in scope.reportParams) {
                        if (scope.reportParams[j].name == paramData.name) {
                            scope.reportParams[j].selectOptions = selectData;
                            isExistedRecord = true;
                        }
                    }
                    if (!isExistedRecord) {
                        if (paramData.selectAll == 'Y') {
                            selectData.push({id: "-1", name: "All"});
                        }
                        paramData.selectOptions = selectData;
                        scope.reportParams.push(paramData);
                    }
                };
                return successFunction;
            }

            function intializeParams(paramData, params) {
                scope.errorStatus = undefined;
                scope.errorDetails = [];
                params.reportSource = paramData.name;
                params.parameterType = true;
                var successFunction = getSuccuessFunction(paramData);
                resourceFactory.runReportsResource.getReport(params, successFunction);
            }

            scope.getDependencies = function (paramData) {
                for (var i = 0; i < scope.reqFields.length; i++) {
                    var temp = scope.reqFields[i];
                    if (temp.parentParameterName == paramData.name) {
                        if (temp.displayType == 'select') {
                            var parentParamValue = this.formData[paramData.inputName];
                            if (parentParamValue != undefined) {
                                var params = {};
                                params[paramData.inputName] = parentParamValue;
                                intializeParams(temp, params);
                            }
                        } else if (temp.displayType == 'date') {
                            scope.reportDateParams.push(temp);
                        }
                    }
                }
            };

            scope.checkStatus = function () {
                return scope.isCollapsed;
            };

            function invalidDate(checkDate) {
                // validates for yyyy-mm-dd returns true if invalid, false is valid
                var dateformat = /^\d{4}(\-|\/|\.)\d{1,2}\1\d{1,2}$/;

                if (!(dateformat.test(checkDate))) {
                    return true;
                } else {
                    var dyear = checkDate.substring(0, 4);
                    var dmonth = checkDate.substring(5, 7) - 1;
                    var dday = checkDate.substring(8);

                    var newDate = new Date(dyear, dmonth, dday);
                    return !((dday == newDate.getDate()) && (dmonth == newDate.getMonth()) && (dyear == newDate.getFullYear()));
                }
            }

            function removeErrors() {
                var $inputs = $(':input');
                $inputs.each(function () {
                    $(this).removeClass("validationerror");
                });
            }

            function addError(paramDetails, code) {
                $('#' + paramDetails.inputName).addClass("validationerror");
                scope.errorDetails.push({
                    field: paramDetails.inputName,
                    code: code,
                    args: {params: [{value: paramDetails.label}]}
                });
            }

            function parameterValidationErrors() {
                var tmpStartDate = "";
                var tmpEndDate = "";
                var paramDetails;
                scope.errorDetails = [];
                for (var i in scope.reqFields) {
                    paramDetails = scope.reqFields[i];
                    var value = scope.formData[paramDetails.inputName];
                    switch (paramDetails.displayType) {
                        case "select":
                        case "text":
                            if (value == undefined || value == 0) {
                                addError(paramDetails, 'error.message.report.parameter.required');
                            }
                            break;
                        case "date":
                            if (value == undefined || !(value > "")) {
                                addError(paramDetails, 'error.message.report.parameter.required');
                            }
                            if (value && invalidDate(value) == true) {
                                addError(paramDetails, 'error.message.report.invalid.value.for.parameter');
                            }
                            if (paramDetails.variable == "startDate") tmpStartDate = value;
                            if (paramDetails.variable == "endDate") tmpEndDate = value;
                            break;
                        case "none":
                            // Hidden parameters (e.g. DefaultLoan) fall back to the template's default value
                            break;
                        default:
                            addError(paramDetails, 'error.message.report.parameter.invalid');
                            break;
                    }
                }

                if (tmpStartDate > "" && tmpEndDate > "" && tmpStartDate > tmpEndDate) {
                    addError(paramDetails, 'error.message.report.incorrect.values.for.date.fields');
                }
            }

            // Jasper params are keyed by the parameter variable ($P{<variable>} in the template), i.e. the inputName
            // without its R_ prefix; report_parameter_name (used by Pentaho) is often null or a display label
            function buildJasperParams() {
                var params = {};
                _.each(scope.reqFields, function (reqField) {
                    params[reqField.inputName.substring(2)] = scope.formData[reqField.inputName];
                });
                return params;
            }

            scope.runReport = function () {
                //clear the previous errors
                scope.errorDetails = [];
                removeErrors();

                //update date fields with proper dateformat
                for (var i in scope.reportDateParams) {
                    if (scope.formData[scope.reportDateParams[i].inputName]) {
                        scope.formData[scope.reportDateParams[i].inputName] = dateFilter(scope.formData[scope.reportDateParams[i].inputName], 'yyyy-MM-dd');
                    }
                }

                //Custom validation for report parameters
                parameterValidationErrors();

                if (scope.errorDetails.length == 0) {
                    scope.isCollapsed = true;
                    // Recreate the viewer so running again with the same parameters still fetches fresh data
                    scope.jasperParams = null;
                    var params = buildJasperParams();
                    $timeout(function () {
                        scope.jasperParams = params;
                    });
                }
            };
        }
    });
    mifosX.ng.application.controller('RunReportsController', ['$scope', '$routeParams', 'ResourceFactory', 'dateFilter', '$timeout', mifosX.controllers.RunReportsController]).run(function ($log) {
        $log.info("RunReportsController initialized");
    });
}(mifosX.controllers || {}));
