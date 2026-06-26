(function (module) {
    mifosX.controllers = _.extend(module, {
        EditDistrictController: function (scope, routeParams, resourceFactory, location) {
            scope.formData = {};
            scope.district = {};

            resourceFactory.districtResource.get({districtId: routeParams.id}, function (data) {
                scope.district = data;
                scope.formData = {
                    code: data.code,
                    nameKhm: data.nameKhm,
                    nameEng: data.nameEng
                };
            });

            scope.submit = function () {
                resourceFactory.districtResource.update({districtId: routeParams.id}, scope.formData, function () {
                    location.path('/districts');
                });
            };
        }
    });
    mifosX.ng.application.controller('EditDistrictController',
        ['$scope', '$routeParams', 'ResourceFactory', '$location', mifosX.controllers.EditDistrictController]);
}(mifosX.controllers || {}));
