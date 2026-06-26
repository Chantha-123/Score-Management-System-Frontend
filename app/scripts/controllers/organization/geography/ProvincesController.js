(function (module) {
    mifosX.controllers = _.extend(module, {
        ProvincesController: function (scope, resourceFactory, location) {
            scope.provinces = [];
            scope.filterText = '';
            scope.ProvincesPerPage = 15;

            scope.routeTo = function (id) {
                location.path('/editprovince/' + id);
            };

            resourceFactory.provinceResource.getAllProvinces(function (data) {
                scope.provinces = data;
            });
        }
    });
    mifosX.ng.application.controller('ProvincesController',
        ['$scope', 'ResourceFactory', '$location', mifosX.controllers.ProvincesController]);
}(mifosX.controllers || {}));
