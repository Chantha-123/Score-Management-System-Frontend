(function (module) {
    mifosX.controllers = _.extend(module, {
        InputScoreController: function (scope, resourceFactory, location, routeParams, dateFilter) {

           scope.formData = {};
           scope.subjects = [];
           scope.subjectId = routeParams.id;      

            resourceFactory.codeValueResource.getAllCodeValues({codeId: 40}, function (data) {
                scope.studyyearotions = data;
    
            });

            resourceFactory.codeValueResource.getAllCodeValues({codeId: 41}, function (data) {
                scope.classoptions = data;
                
            });
            resourceFactory.codeValueResource.getAllCodeValues({codeId: 42}, function (data) {
                scope.subjects = data;
                console.log(scope.subjectId);
                scope.formData.subject = Number(scope.subjectId);
            });

           
            resourceFactory.codeValueResource.getAllCodeValues({codeId: 43}, function (data) {
                scope.scoretypeoptions = data;
                
            });
            resourceFactory.codeValueResource.getAllCodeValues({codeId: 44}, function (data) {
                scope.monthlyoptions = data;

                
    
            });

            scope.showmonth = false;
            scope.checksocretype = function(id)
            {
               
                if(Number(id) == Number(29))
                {
                 
                    scope.showmonth = true;
                }
                else{
                    scope.showmonth = false;
                }
               
            }

            
            
        }
    });
    mifosX.ng.application.controller('InputScoreController', ['$scope', 'ResourceFactory', '$location', '$routeParams', 'dateFilter', mifosX.controllers.InputScoreController]).run(function ($log) {
        $log.info("InputScoreController initialized");
    });
}(mifosX.controllers || {}));
