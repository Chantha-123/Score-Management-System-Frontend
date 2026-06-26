(function (module) {
    mifosX.controllers = _.extend(module, {
        EditCommuneController: function (scope, routeParams, resourceFactory, location) {
            scope.formData = {};
            scope.commune = {};

            resourceFactory.communeResource.get({communeId: routeParams.id}, function (data) {
                scope.commune = data;
                scope.formData = {
                    code: data.code,
                    nameKhm: data.nameKhm,
                    nameEng: data.nameEng
                };
            });

            scope.submit = function () {
                resourceFactory.communeResource.update({communeId: routeParams.id}, scope.formData, function () {
                    location.path('/communes');
                });
            };
        }
    });
    mifosX.ng.application.controller('EditCommuneController',
        ['$scope', '$routeParams', 'ResourceFactory', '$location', mifosX.controllers.EditCommuneController]);
}(mifosX.controllers || {}));
