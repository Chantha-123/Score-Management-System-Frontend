(function (module) {
    mifosX.controllers = _.extend(module, {
        // Standalone Jasper report page: #/jasper/<report name>?R_transactionId=9 (R_ query values become report parameters)
        JasperReportController: function (scope, routeParams, location) {
            scope.reportName = routeParams.name;
            scope.params = {};
            _.each(location.search(), function (value, key) {
                if (key.indexOf("R_") === 0) {
                    scope.params[key.substring(2)] = value;
                }
            });
        }
    });
    mifosX.ng.application.controller('JasperReportController', ['$scope', '$routeParams', '$location', mifosX.controllers.JasperReportController]).run(function ($log) {
        $log.info("JasperReportController initialized");
    });
}(mifosX.controllers || {}));
