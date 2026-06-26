(function (module) {
    mifosX.controllers = _.extend(module, {
        CommunesController: function (scope, resourceFactory, location) {
            scope.communes = [];
            scope.filterText = '';
            scope.CommunesPerPage = 15;

            scope.routeTo = function (id) {
                location.path('/editcommune/' + id);
            };

            resourceFactory.communeResource.getAllCommunes(function (data) {
                scope.communes = data;
            });
        }
    });
    mifosX.ng.application.controller('CommunesController',
        ['$scope', 'ResourceFactory', '$location', mifosX.controllers.CommunesController]);
}(mifosX.controllers || {}));
