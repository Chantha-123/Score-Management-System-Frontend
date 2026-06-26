(function (module) {
    mifosX.controllers = _.extend(module, {
        CreateVillageController: function (scope, resourceFactory, location) {
            scope.formData = {};
            scope.communes = [];

            resourceFactory.communeResource.getAllCommunes(function (data) {
                scope.communes = data;
                if (data.length > 0) {
                    scope.formData.communeId = data[0].id;
                }
            });

            scope.submit = function () {
                resourceFactory.villageResource.save(scope.formData, function () {
                    location.path('/villages');
                });
            };
        }
    });
    mifosX.ng.application.controller('CreateVillageController',
        ['$scope', 'ResourceFactory', '$location', mifosX.controllers.CreateVillageController]);
}(mifosX.controllers || {}));
