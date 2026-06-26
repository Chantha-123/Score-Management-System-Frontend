(function (module) {
    mifosX.controllers = _.extend(module, {
        EditSpotRateController: function (scope, routeParams, resourceFactory, location, dateFilter) {
            scope.formData = {};
            scope.first = {};

            resourceFactory.officeResource.getAllOffices(function (data) {
                scope.offices = data;
            });

            resourceFactory.currencyConfigResource.get({fields: 'selectedCurrencyOptions'}, function (data) {
                scope.currencyOptions = data.selectedCurrencyOptions;
            });

            resourceFactory.spotRateResource.get({spotRateId: routeParams.id}, function (data) {
                scope.spotRateId = data.id;
                scope.formData = {
                    officeId: data.officeId,
                    currencyCode: data.currencyCode,
                    spotRate: data.spotRate,
                    buyingRate: data.buyingRate,
                    sellingRate: data.sellingRate
                };
                if (data.rateDate) {
                    var d = data.rateDate;
                    scope.first.rateDate = Array.isArray(d)
                        ? new Date(d[0], d[1] - 1, d[2])
                        : new Date(d);
                }
            });

            scope.submit = function () {
                var reqDate = dateFilter(scope.first.rateDate, scope.df);
                this.formData.locale = scope.optlang.code;
                this.formData.dateFormat = scope.df;
                this.formData.rateDate = reqDate;
                resourceFactory.spotRateResource.update({spotRateId: routeParams.id}, this.formData, function (data) {
                    location.path('/viewspotrate/' + data.resourceId);
                });
            };
        }
    });
    mifosX.ng.application.controller('EditSpotRateController',
        ['$scope', '$routeParams', 'ResourceFactory', '$location', 'dateFilter',
        mifosX.controllers.EditSpotRateController]).run(function ($log) {
        $log.info("EditSpotRateController initialized");
    });
}(mifosX.controllers || {}));
