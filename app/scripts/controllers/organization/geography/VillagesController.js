(function (module) {
    mifosX.controllers = _.extend(module, {
        VillagesController: function (scope, resourceFactory, location) {
            scope.villages = [];
            scope.filterText = '';
            scope.VillagesPerPage = 15;

            scope.routeTo = function (id) {
                location.path('/editvillage/' + id);
            };

            resourceFactory.villageResource.getAllVillages(function (data) {
                scope.villages = data;
            });
        }
    });
    mifosX.ng.application.controller('VillagesController',
        ['$scope', 'ResourceFactory', '$location', mifosX.controllers.VillagesController]);
}(mifosX.controllers || {}));
