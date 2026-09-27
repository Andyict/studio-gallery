(function () {
  'use strict';
  SYNO.namespace('SYNO.SDS.App.StudioGallery');
  var base='/webman/3rdparty/StudioGallery/';
  SYNO.SDS.App.StudioGallery.Instance=Vue.extend({
    data:function(){return {user:null,username:'',password:'',busy:false,error:'',notice:'',sources:[],selected:null,section:'overview',search:''};},
    mounted:function(){this.load();},
    methods:{
      request:async function(route,method,body){
        var controller=new AbortController();
        var timer=setTimeout(function(){controller.abort();},route.indexOf('/discover')>=0?120000:20000);
        var response,data;
        try{response=await fetch(base+'api.cgi?route='+encodeURIComponent(route),{method:method||'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});data=await response.json();}
        catch(e){throw new Error(e.name==='AbortError'?'Yêu cầu quá thời gian. Hãy bấm Làm mới để kiểm tra kết quả.':'Không kết nối được Console: '+e.message);}
        finally{clearTimeout(timer);}
        var status=data.status||response.status;data=data.data||data;
        if(status>=400){if(status===401)this.user=null;throw new Error(data.message||data.error||'Không thực hiện được thao tác');}return data;
      },
      run:async function(action){this.busy=true;this.error='';this.notice='';try{await action();}catch(e){this.error=e.message;}finally{this.busy=false;}},
      load:async function(){var self=this;await this.run(async function(){self.user=await self.request('admin/me');self.sources=await self.request('admin/shares');});},
      login:async function(){var self=this;await this.run(async function(){await self.request('admin/login','POST',{username:self.username,password:self.password});self.password='';self.user=await self.request('admin/me');self.sources=await self.request('admin/shares');});},
      toggle:async function(enabled){var self=this,selected=this.selected;await this.run(async function(){if(enabled&&!selected.readable)throw new Error('Chưa có quyền đọc. DSM → Control Panel → Shared Folder → Edit → Permissions → System internal user → StudioGallery → Read only.'); if(!selected.id){await self.request('admin/sources','POST',{label:selected.label,relative_path:selected.relative_path});}else{await self.request('admin/sources/'+selected.id,'PATCH',{label:selected.label,enabled:enabled});}self.sources=await self.request('admin/shares');self.selected=self.sources.find(function(s){return s.relative_path===selected.relative_path;})||null;self.notice=enabled?'Đã bật nguồn ảnh.':'Đã tắt nguồn ảnh.';});},
      discover:async function(){var self=this;await this.run(async function(){await self.request('admin/sources/'+self.selected.id+'/discover','POST',{});self.notice='Đã quét thư mục nguồn.';});}
    },
    render:function(h){
      var self=this;
      function button(label,action,disabled,primary){return h('button',{attrs:{type:'button',disabled:self.busy||disabled},on:{click:action},style:{height:'30px',padding:'0 13px',marginRight:'6px',border:'1px solid #d8e0e8',borderRadius:'3px',background:primary?'#e6f1fb':'#f5f8fb',color:disabled?'#a8b2bc':'#30465a',cursor:disabled?'default':'pointer',fontSize:'13px'}},label);}
      function input(key,placeholder,type){return h('input',{attrs:{placeholder:placeholder,type:type||'text','aria-label':placeholder},domProps:{value:self[key]},on:{input:function(e){self[key]=e.target.value;}},style:{height:'30px',boxSizing:'border-box',padding:'5px 10px',border:'1px solid #d8e0e8',borderRadius:'3px',fontSize:'13px'}});}
      function cell(value,head){return h(head?'th':'td',{style:{textAlign:'left',height:head?'28px':'29px',padding:'0 9px',borderBottom:'1px solid #e8edf2',fontWeight:head?'normal':'normal',background:head?'#f5f8fa':undefined,color:head?'#718193':undefined}},value);}
      var content;
      if(!this.user){content=h('form',{on:{submit:function(e){e.preventDefault();self.login();}},style:{maxWidth:'330px',margin:'65px auto',display:'grid',gap:'12px'}},[h('h2',{style:{fontSize:'18px',margin:'0 0 4px'}},'Đăng nhập Studio Gallery'),h('p',{style:{margin:'0 0 6px',color:'#718193'}},'Dùng tài khoản quản trị Studio Gallery.'),input('username','Tên đăng nhập'),input('password','Mật khẩu','password'),h('button',{attrs:{type:'submit',disabled:this.busy},style:{height:'34px',background:'#e6f1fb',border:'1px solid #c8dcec',borderRadius:'3px'}},'Đăng nhập')]);}
      else if(this.section==='overview'){content=h('div',[h('h2',{style:{fontSize:'19px',fontWeight:'normal',margin:'0 0 18px'}},'Tổng quan'),h('div',{style:{border:'1px solid #e2e8ed',padding:'20px',background:'#f8fafb'}},[h('strong',{style:{color:'#248557',fontSize:'17px'}},'● Studio Gallery đang hoạt động'),h('p','Tài khoản: '+this.user.name),h('p','Shared folder: '+this.sources.length+' · Đang bật: '+this.sources.filter(function(s){return s.enabled;}).length)]),h('p',{style:{color:'#718193'}},'Vào Thư mục nguồn để bật và quản lý các shared folder trên NAS.')]);}
      else {
        var rows=this.sources.filter(function(s){return (s.label+' '+s.path).toLowerCase().includes(self.search.toLowerCase());});
        content=h('div',{style:{height:'100%',display:'flex',flexDirection:'column'}},[
          h('div',{style:{paddingBottom:'12px',borderBottom:'1px solid #e3e8ed'}},[h('p',{style:{margin:'0 0 10px',color:'#52677b'}},'Bật shared folder để Studio Gallery có thể tạo và quản lý album ảnh trong đó.'),h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between'}},[h('div',[button('Bật',function(){self.toggle(true);},!this.selected||this.selected.enabled||!this.selected.readable||this.user.role!=='admin',true),button('Tắt',function(){self.toggle(false);},!this.selected||!this.selected.enabled||this.user.role!=='admin'),button('Quét thư mục',this.discover,!this.selected||!this.selected.enabled)]),h('div',{style:{display:'flex',alignItems:'center'}},[input('search','Tìm shared folder'),button('↻',this.load,false)])])]),
          h('div',{style:{flex:'1',overflow:'auto'}},[h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:'13px',marginTop:'8px'}},[h('thead',[h('tr',[cell('Tên shared folder',true),cell('Trạng thái',true),cell('Đường dẫn NAS',true)])]),h('tbody',rows.map(function(s){var state=!s.readable?'Chưa có quyền đọc':s.enabled?'Đã bật':'Chưa bật';return h('tr',{key:s.relative_path,on:{click:function(){self.selected=s;}},style:{background:self.selected&&self.selected.relative_path===s.relative_path?'#dfefff':'#fff',cursor:'pointer'}},[cell(s.label),cell(h('span',{style:{color:s.enabled?'#21934e':s.readable?'#a7b2bc':'#bd694e'}},state)),cell(s.path)]);} ))]),!rows.length?h('p',{style:{textAlign:'center',color:'#8a98a7',padding:'24px'}},'Không tìm thấy shared folder.'):null]),
          h('div',{style:{borderTop:'1px solid #e3e8ed',textAlign:'right',padding:'8px 0',fontSize:'12px',color:'#697d90'}},rows.length+' thư mục')]);
      }
      return h('v-app-instance',{attrs:{'class-name':'SYNO.SDS.App.StudioGallery.Instance'}},[h('v-app-window',{ref:'window',attrs:{width:1120,height:670,resizable:true,'syno-id':'SYNO.SDS.App.StudioGallery.Window'}},[h('div',{style:{display:'flex',height:'100%',background:'#fff',color:'#33475b',fontFamily:'Arial,sans-serif',fontSize:'13px'}},[h('aside',{style:{width:'208px',flexShrink:0,padding:'16px 10px',borderRight:'1px solid #e1e6eb',background:'#fbfcfd'}},[['overview','▣  Tổng quan'],['folders','▣  Thư mục nguồn']].map(function(n){return h('button',{attrs:{type:'button'},on:{click:function(){self.section=n[0];}},style:{display:'block',width:'100%',height:'36px',padding:'0 12px',textAlign:'left',marginBottom:'4px',border:0,borderRadius:'3px',background:self.section===n[0]?'#e2f0fc':'transparent',color:'#38516a',fontSize:'13px'}},n[1]);})),h('section',{style:{flex:1,padding:'18px 16px 10px',overflow:'auto',display:'flex',flexDirection:'column'}},[content,this.busy?h('p',{attrs:{role:'status'},style:{color:'#718193',margin:'8px 0'}},'Đang xử lý…'):null,this.error?h('p',{attrs:{role:'alert'},style:{color:'#b23d32',padding:'10px',background:'#fff0ec',margin:'8px 0'}},this.error):null,this.notice?h('p',{attrs:{role:'status'},style:{color:'#248557',margin:'8px 0'}},this.notice):null])])])]);
    }
  });
}());
