(function (module) {
    mifosX.controllers = _.extend(module, {
        ViewSpotRateController: function (scope, routeParams, resourceFactory, location) {
            scope.spotRate = {};

            resourceFactory.spotRateResource.get({spotRateId: routeParams.id}, function (data) {
                scope.spotRate = data;
            });
        }
    });
    mifosX.ng.application.controller('ViewSpotRateController',
        ['$scope', '$routeParams', 'ResourceFactory', '$location',
        mifosX.controllers.ViewSpotRateController]).run(function ($log) {
        $log.info("ViewSpotRateController initialized");
    });
}(mifosX.controllers || {}));
