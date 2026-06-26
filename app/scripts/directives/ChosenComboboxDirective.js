(function (module) {
    mifosX.directives = _.extend(module, {
        ChosenComboboxDirective: function ($compile, $timeout) {
            var linker = function (scope, element, attrs) {
                var list = attrs['chosen'];
                var ngModel = attrs['ngModel'];

                $timeout(function () {
                    element.chosen({search_contains: true});
                });

                // $watchCollection catches reference replacements AND in-place push/splice.
                // Skip the initial fire (newVal === oldVal) — that fires before Chosen is ready
                // and leaves the dropdown stuck open.
                scope.$watchCollection(list, function (newVal, oldVal) {
                    if (newVal === oldVal) { return; }
                    $timeout(function () {
                        element.trigger('liszt:updated');
                        element.trigger('chosen:updated');
                    });
                });

                // Re-sync when the selected value changes without the list changing
                // (e.g. programmatic pre-selection in edit forms).
                if (ngModel) {
                    scope.$watch(ngModel, function (newVal, oldVal) {
                        if (newVal === oldVal) { return; }
                        $timeout(function () {
                            element.trigger('chosen:updated');
                        });
                    });
                }
            };

            return {
                restrict: 'A',
                link: linker
            };
        }
    });
}(mifosX.directives || {}));

mifosX.ng.application.directive("chosen", ['$compile', '$timeout', mifosX.directives.ChosenComboboxDirective]).run(function ($log) {
    $log.info("ChosenComboboxDirective initialized");
});
