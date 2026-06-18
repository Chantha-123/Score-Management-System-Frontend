(function (module) {
    mifosX.controllers = _.extend(module, {
        SpotRateController: function (scope, resourceFactory, location, anchorScroll) {
            scope.spotRates = [];

            resourceFactory.spotRateResource.getAll(function (data) {
                scope.spotRates = data;
            });

            scope.routeTo = function (id) {
                location.path('/viewspotrate/' + id);
            };

            scope.scrollto = function (link) {
                location.hash(link);
                anchorScroll();
            };
        }
    });
    mifosX.ng.application.controller('SpotRateController',
        ['$scope', 'ResourceFactory', '$location', '$anchorScroll',
        mifosX.controllers.SpotRateController]).run(function ($log) {
        $log.info("SpotRateController initialized");
    });
}(mifosX.controllers || {}));
