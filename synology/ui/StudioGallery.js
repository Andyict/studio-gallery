(function () {
  if (!window.SYNO) return;
  SYNO.namespace('SYNO.SDS.App.StudioGallery');
  var component = {
    template: '<v-app-instance class-name="SYNO.SDS.App.StudioGallery.Instance"><v-app-window width="1180" height="760" ref="window" :resizable="true" syno-id="SYNO.SDS.App.StudioGallery.Window"><iframe src="http://192.168.50.246:3215/console" style="width:100%;height:100%;border:0;background:#f7f9f7"></iframe></v-app-window></v-app-instance>'
  };
  SYNO.SDS.App.StudioGallery.Instance = Vue.extend(component);
}());
