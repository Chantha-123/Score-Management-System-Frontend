(function (module) {
    mifosX.controllers = _.extend(module, {
        CreateSpotRateController: function (scope, resourceFactory, location, dateFilter) {
            scope.formData = {};
            scope.first = {};
            scope.first.rateDate = new Date();
            scope.restrictDate = new Date();

            resourceFactory.officeResource.getAllOffices(function (data) {
                scope.offices = data;
            });

            resourceFactory.currencyConfigResource.get({fields: 'selectedCurrencyOptions'}, function (data) {
                scope.currencyOptions = data.selectedCurrencyOptions;
            });

            scope.submit = function () {
                var reqDate = dateFilter(scope.first.rateDate, scope.df);
                this.formData.locale = scope.optlang.code;
                this.formData.dateFormat = scope.df;
                this.formData.rateDate = reqDate;
                resourceFactory.spotRateResource.save(this.formData, function (data) {
                    location.path('/viewspotrate/' + data.resourceId);
                });
            };
        }
    });
    mifosX.ng.application.controller('CreateSpotRateController',
        ['$scope', 'ResourceFactory', '$location', 'dateFilter',
        mifosX.controllers.CreateSpotRateController]).run(function ($log) {
        $log.info("CreateSpotRateController initialized");
    });
}(mifosX.controllers || {}));
