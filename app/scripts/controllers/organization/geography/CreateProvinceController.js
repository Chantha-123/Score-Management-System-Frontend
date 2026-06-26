(function (module) {
    mifosX.controllers = _.extend(module, {
        CreateProvinceController: function (scope, resourceFactory, location) {
            scope.formData = {};

            scope.submit = function () {
                resourceFactory.provinceResource.save(scope.formData, function (data) {
                    location.path('/provinces');
                });
            };
        }
    });
    mifosX.ng.application.controller('CreateProvinceController',
        ['$scope', 'ResourceFactory', '$location', mifosX.controllers.CreateProvinceController]);
}(mifosX.controllers || {}));
