(function (module) {
    mifosX.controllers = _.extend(module, {
        EditVillageController: function (scope, routeParams, resourceFactory, location) {
            scope.formData = {};
            scope.village = {};

            resourceFactory.villageResource.get({villageId: routeParams.id}, function (data) {
                scope.village = data;
                scope.formData = {
                    code: data.code,
                    nameKhm: data.nameKhm,
                    nameEng: data.nameEng
                };
            });

            scope.submit = function () {
                resourceFactory.villageResource.update({villageId: routeParams.id}, scope.formData, function () {
                    location.path('/villages');
                });
            };
        }
    });
    mifosX.ng.application.controller('EditVillageController',
        ['$scope', '$routeParams', 'ResourceFactory', '$location', mifosX.controllers.EditVillageController]);
}(mifosX.controllers || {}));
