(function (module) {
    mifosX.controllers = _.extend(module, {
        SubjectController: function (scope, resourceFactory, location, routeParams, dateFilter) {
           scope.ismonthlyscore = true;
            resourceFactory.codeValueResource.getAllCodeValues({codeId: 42}, function (data) {
                scope.subjects = data;

                console.log(scope.subjects);
    
            });

            
        }
    });
    mifosX.ng.application.controller('SubjectController', ['$scope', 'ResourceFactory', '$location', '$routeParams', 'dateFilter', mifosX.controllers.SubjectController]).run(function ($log) {
        $log.info("SubjectController initialized");
    });
}(mifosX.controllers || {}));
