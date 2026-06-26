(function (module) {
    mifosX.controllers = _.extend(module, {
        CreateCommuneController: function (scope, resourceFactory, location) {
            scope.formData = {};
            scope.districts = [];

            resourceFactory.districtResource.getAllDistricts(function (data) {
                scope.districts = data;
                if (data.length > 0) {
                    scope.formData.districtId = data[0].id;
                }
            });

            scope.submit = function () {
                resourceFactory.communeResource.save(scope.formData, function () {
                    location.path('/communes');
                });
            };
        }
    });
    mifosX.ng.application.controller('CreateCommuneController',
        ['$scope', 'ResourceFactory', '$location', mifosX.controllers.CreateCommuneController]);
}(mifosX.controllers || {}));
