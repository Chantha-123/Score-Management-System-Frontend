(function (module) {
    mifosX.controllers = _.extend(module, {
        EditCollateralController: function (scope, resourceFactory, routeParams, location) {

            scope.collateralId = routeParams.id;

            resourceFactory.collateralTemplateResource.getAllCurrency(function (data) {
                scope.currencyOptions = data;
            });

            resourceFactory.collateralResource.get({collateralId: scope.collateralId}, function (data) {
                scope.collateral = data;
                scope.formData = {
                    name: data.name,
                    unitType: data.unitType,
                    type: data.quality,
                    currency: data.currency
                };
            });

            scope.cancel = function () {
                location.path('/collaterals');
            };

            scope.submit = function () {
                this.formData.locale = scope.optlang.code;
                // the API field is "quality"; the form binds it as "type"
                this.formData.quality = this.formData.type;
                delete this.formData.type;
                resourceFactory.collateralResource.update({collateralId: scope.collateralId}, this.formData, function (data) {
                    location.path('/viewcollateral/' + scope.collateralId);
                });
            };

        }
    });
    mifosX.ng.application.controller('EditCollateralController', ['$scope', 'ResourceFactory', '$routeParams', '$location', mifosX.controllers.EditCollateralController]).run(function ($log) {
        $log.info("EditCollateralController initialized");
    });
}(mifosX.controllers || {}));
