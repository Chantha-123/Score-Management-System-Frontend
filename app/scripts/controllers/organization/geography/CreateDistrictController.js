(function (module) {
    mifosX.controllers = _.extend(module, {
        CreateDistrictController: function (scope, resourceFactory, location) {
            scope.formData = {};
            scope.provinces = [];

            resourceFactory.provinceResource.getAllProvinces(function (data) {
                scope.provinces = data;
                if (data.length > 0) {
                    scope.formData.provinceId = data[0].id;
                }
            });

            scope.submit = function () {
                resourceFactory.districtResource.save(scope.formData, function () {
                    location.path('/districts');
                });
            };
        }
    });
    mifosX.ng.application.controller('CreateDistrictController',
        ['$scope', 'ResourceFactory', '$location', mifosX.controllers.CreateDistrictController]);
}(mifosX.controllers || {}));
