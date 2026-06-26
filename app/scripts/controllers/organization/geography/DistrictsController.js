(function (module) {
    mifosX.controllers = _.extend(module, {
        DistrictsController: function (scope, resourceFactory, location) {
            scope.districts = [];
            scope.filterText = '';
            scope.DistrictsPerPage = 15;

            scope.routeTo = function (id) {
                location.path('/editdistrict/' + id);
            };

            resourceFactory.districtResource.getAllDistricts(function (data) {
                scope.districts = data;
            });
        }
    });
    mifosX.ng.application.controller('DistrictsController',
        ['$scope', 'ResourceFactory', '$location', mifosX.controllers.DistrictsController]);
}(mifosX.controllers || {}));
