(function (module) {
    mifosX.directives = _.extend(module, {
        /**
         * Unified viewer for Jasper reports (stretchy reports of type "Jasper").
         *
         *   <jasper-report-viewer report-name="Loan Transaction Receipt Khmer" params="{transactionId: 9}"></jasper-report-viewer>
         *
         * The preview is fetched as PNG page images inside JSON (output-type=PREVIEW) and downloads come back as base64 JSON
         * (as-json=true), so no PDF or file response ever reaches the browser: download managers such as IDM intercept those,
         * and re-request them without the Authorization header.
         */
        JasperReportViewerDirective: function ($http, $rootScope, $translate, $window, API_VERSION) {
            return {
                restrict: "E",
                scope: {
                    reportName: "@",
                    params: "="
                },
                template: "<div class='jasper-report-viewer'>" +
                    "<div class='btn-toolbar' style='margin-bottom:10px;'>" +
                    "<div class='btn-group'>" +
                    "<button type='button' class='btn btn-default' ng-click='download(\"PDF\")' ng-disabled='!preview || busy'><i class='fa fa-file-pdf-o'></i>&nbsp;{{'label.button.exportpdf' | translate}}</button>" +
                    "<button type='button' class='btn btn-default' ng-click='download(\"XLSX\")' ng-disabled='!preview || busy'><i class='fa fa-file-excel-o'></i>&nbsp;{{'label.button.exportexcel' | translate}}</button>" +
                    "<button type='button' class='btn btn-default' ng-click='download(\"DOCX\")' ng-disabled='!preview || busy'><i class='fa fa-file-word-o'></i>&nbsp;{{'label.button.exportword' | translate}}</button>" +
                    "</div>" +
                    "<div class='btn-group'>" +
                    "<button type='button' class='btn btn-primary' ng-click='print()' ng-disabled='!preview'><i class='fa fa-print'></i>&nbsp;{{'label.button.print' | translate}}</button>" +
                    "</div>" +
                    "<div class='btn-group'>" +
                    "<button type='button' class='btn btn-default' ng-click='zoomBy(-0.25)' ng-disabled='!preview || scale <= 0.5'><i class='fa fa-search-minus'></i></button>" +
                    "<button type='button' class='btn btn-default' ng-click='zoomBy(0.25)' ng-disabled='!preview || scale >= 2.5'><i class='fa fa-search-plus'></i></button>" +
                    "</div>" +
                    "</div>" +
                    "<div ng-show='loading' class='text-muted'><i class='fa fa-spinner fa-spin'></i>&nbsp;{{'label.jasper.loading' | translate}}</div>" +
                    "<div ng-show='error' class='alert alert-danger'>{{error}}</div>" +
                    "<div ng-show='preview.truncated' class='alert alert-warning'>{{'label.jasper.truncated' | translate}}</div>" +
                    "<div ng-show='preview && !loading' style='background:#e9e9e9;padding:16px;overflow:auto;text-align:center;'>" +
                    "<img ng-repeat='page in preview.pages track by $index' ng-src='{{page}}' alt='Page {{$index + 1}}'" +
                    " ng-style='{width: (preview.pageWidth * scale) + \"pt\"}'" +
                    " style='max-width:none;display:block;margin:0 auto 16px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3);'/>" +
                    "</div>" +
                    "</div>",
                link: function (scope) {
                    scope.scale = 1.25;

                    function reportUrl(outputType, extra) {
                        var url = $rootScope.hostUrl + API_VERSION + "/runreports/" + encodeURIComponent(scope.reportName) +
                            "?output-type=" + outputType + "&tenantIdentifier=" + $rootScope.tenantIdentifier +
                            "&locale=" + encodeURIComponent($translate.use() || "en") + (extra || "");
                        _.each(scope.params || {}, function (value, name) {
                            if (value !== undefined && value !== null && value !== "") {
                                url += "&" + encodeURIComponent("R_" + name) + "=" + encodeURIComponent(value);
                            }
                        });
                        return url;
                    }

                    function errorMessage(response) {
                        var data = response && response.data;
                        if (data && data.errors && data.errors.length) {
                            return data.errors[0].defaultUserMessage;
                        }
                        if (data && data.defaultUserMessage) {
                            return data.defaultUserMessage;
                        }
                        return "Report request failed" + (response && response.status ? " (HTTP " + response.status + ")" : "");
                    }

                    function load() {
                        scope.preview = null;
                        scope.error = null;
                        if (!scope.reportName || !scope.params) {
                            return;
                        }
                        scope.loading = true;
                        $http.get(reportUrl("PREVIEW", "&zoom=2")).then(function (response) {
                            scope.preview = response.data;
                        }, function (response) {
                            scope.error = errorMessage(response);
                        }).finally(function () {
                            scope.loading = false;
                        });
                    }

                    scope.download = function (outputType) {
                        scope.busy = true;
                        scope.error = null;
                        $http.get(reportUrl(outputType, "&as-json=true")).then(function (response) {
                            var bytes = atob(response.data.data);
                            var buffer = new Uint8Array(bytes.length);
                            for (var i = 0; i < bytes.length; i++) {
                                buffer[i] = bytes.charCodeAt(i);
                            }
                            var fileUrl = URL.createObjectURL(new Blob([buffer], {type: response.data.mediaType}));
                            var link = document.createElement("a");
                            link.href = fileUrl;
                            link.download = response.data.fileName;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            setTimeout(function () {
                                URL.revokeObjectURL(fileUrl);
                            }, 1000);
                        }, function (response) {
                            scope.error = errorMessage(response);
                        }).finally(function () {
                            scope.busy = false;
                        });
                    };

                    // Prints the preview images at the report's page size; no PDF is requested
                    scope.print = function () {
                        var preview = scope.preview;
                        var printWindow = $window.open("", "_blank");
                        if (!printWindow) {
                            scope.error = "The print window was blocked by the browser.";
                            return;
                        }
                        var html = "<html><head><title>" + _.escape(scope.reportName) + "</title><style>" +
                            "@page { size: " + preview.pageWidth + "pt " + preview.pageHeight + "pt; margin: 0; }" +
                            "body { margin: 0; } img { display: block; width: " + preview.pageWidth + "pt; page-break-after: always; }" +
                            "</style></head><body>";
                        _.each(preview.pages, function (page) {
                            html += "<img src='" + page + "'/>";
                        });
                        html += "<script>window.onload = function () { window.focus(); window.print(); };<\/script></body></html>";
                        printWindow.document.open();
                        printWindow.document.write(html);
                        printWindow.document.close();
                    };

                    scope.zoomBy = function (step) {
                        scope.scale = Math.max(0.5, Math.min(2.5, scope.scale + step));
                    };

                    scope.$watch(function () {
                        return [scope.reportName, scope.params];
                    }, load, true);
                }
            };
        }
    });
}(mifosX.directives || {}));

mifosX.ng.application.directive("jasperReportViewer", ['$http', '$rootScope', '$translate', '$window', 'API_VERSION', mifosX.directives.JasperReportViewerDirective]).run(function ($log) {
    $log.info("JasperReportViewerDirective initialized");
});
