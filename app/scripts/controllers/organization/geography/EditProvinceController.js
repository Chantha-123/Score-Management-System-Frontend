(function (module) {
    mifosX.controllers = _.extend(module, {
        EditProvinceController: function (scope, routeParams, resourceFactory, location) {
            scope.formData = {};

            resourceFactory.provinceResource.get({provinceId: routeParams.id}, function (data) {
                scope.formData = {
                    code: data.code,
                    nameKhm: data.nameKhm,
                    nameEng: data.nameEng
                };
            });

            scope.submit = function () {
                resourceFactory.provinceResource.update({provinceId: routeParams.id}, scope.formData, function () {
                    location.path('/provinces');
                });
            };
        }
    });
    mifosX.ng.application.controller('EditProvinceController',
        ['$scope', '$routeParams', 'ResourceFactory', '$location', mifosX.controllers.EditProvinceController]);
}(mifosX.controllers || {}));
