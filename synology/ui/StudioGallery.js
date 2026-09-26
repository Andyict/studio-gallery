(function () {
  'use strict';
  SYNO.namespace('SYNO.SDS.App.StudioGallery');
  var base='/webman/3rdparty/StudioGallery/';
  SYNO.SDS.App.StudioGallery.Instance=Vue.extend({
    data:function(){return {user:null,username:'',password:'',busy:false,error:'',notice:'',sources:[],selected:null,section:'overview',search:'',directories:null,folderPath:'',label:''};},
    mounted:function(){this.load();},
    methods:{
      request:async function(route,method,body){
        var response=await fetch(base+'api.cgi?route='+encodeURIComponent(route),{method:method||'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
        var data;try{data=await response.json();}catch(e){throw new Error('Dịch vụ Console không phản hồi hợp lệ ('+response.status+').');}
        var status=data.status||response.status;data=data.data||data;
        if(status>=400){if(status===401)this.user=null;throw new Error(data.message||data.error||'Không thực hiện được thao tác');}return data;
      },
      run:async function(action){this.busy=true;this.error='';this.notice='';try{await action();}catch(e){this.error=e.message;}finally{this.busy=false;}},
      load:async function(){var self=this;await this.run(async function(){self.user=await self.request('admin/me');self.sources=await self.request('admin/sources');});},
      login:async function(){var self=this;await this.run(async function(){await self.request('admin/login','POST',{username:self.username,password:self.password});self.password='';self.user=await self.request('admin/me');self.sources=await self.request('admin/sources');});},
      toggle:async function(enabled){var self=this;await this.run(async function(){await self.request('admin/sources/'+self.selected.id,'PATCH',{label:self.selected.label,enabled:enabled});self.sources=await self.request('admin/sources');self.selected=null;self.notice='Đã cập nhật nguồn ảnh.';});},
      browse:async function(path){var self=this;await this.run(async function(){self.directories=await self.request('admin/directories?path='+encodeURIComponent(path));self.folderPath=path;self.label=path.split('/').pop()||'Studio';});},
      add:async function(){var self=this;await this.run(async function(){await self.request('admin/sources','POST',{relative_path:self.folderPath,label:self.label});self.sources=await self.request('admin/sources');self.directories=null;self.notice='Đã bật thư mục nguồn.';});},
      discover:async function(){var self=this;await this.run(async function(){await self.request('admin/sources/'+self.selected.id+'/discover','POST',{});self.notice='Đã quét thư mục nguồn.';});}
    },
    render:function(h){
      var self=this;
      function button(label,action,disabled){return h('button',{attrs:{type:'button',disabled:self.busy||disabled},on:{click:action},style:{padding:'8px 14px',marginRight:'8px',border:'1px solid #c8d4df',borderRadius:'4px',background:'#fff',cursor:'pointer'}},label);}
      function input(key,placeholder,type){return h('input',{attrs:{placeholder:placeholder,type:type||'text','aria-label':placeholder},domProps:{value:self[key]},on:{input:function(e){self[key]=e.target.value;}},style:{padding:'9px',border:'1px solid #c8d4df',borderRadius:'4px',margin:'8px 8px 8px 0'}});}
      var content;
      if(!this.user){content=h('form',{on:{submit:function(e){e.preventDefault();self.login();}},style:{maxWidth:'370px',margin:'50px auto'}},[h('h2','Đăng nhập Studio Gallery'),h('p','Dùng tài khoản quản trị Studio Gallery để quản lý nguồn ảnh.'),input('username','Tên đăng nhập'),input('password','Mật khẩu','password'),h('button',{attrs:{type:'submit',disabled:this.busy},style:{display:'block',padding:'10px 20px'}},'Đăng nhập')]);}
      else if(this.section==='overview'){content=h('div',[h('h2','Tổng quan'),h('p',{style:{color:'#26834a',fontSize:'18px'}},'✓ Đã kết nối Studio Gallery'),h('p','Tài khoản: '+this.user.name),h('p','Nguồn ảnh: '+this.sources.length+' · Đang bật: '+this.sources.filter(function(s){return s.enabled;}).length),h('p','Chọn Thư mục nguồn để bật, tắt và quét các thư mục được cấp quyền.')]);}
      else {
        var rows=this.sources.filter(function(s){return (s.label+' '+s.relative_path).toLowerCase().includes(self.search.toLowerCase());});
        content=h('div',[h('h2','Thư mục nguồn'),h('div',[button('Thêm thư mục',function(){self.browse('');},this.user.role!=='admin'),button('Bật',function(){self.toggle(true);},!this.selected||this.selected.enabled||this.user.role!=='admin'),button('Tắt',function(){self.toggle(false);},!this.selected||!this.selected.enabled||this.user.role!=='admin'),button('Quét thư mục',this.discover,!this.selected||!this.selected.enabled),button('Làm mới',this.load),input('search','Tìm thư mục')]),
          h('table',{style:{width:'100%',borderCollapse:'collapse',marginTop:'16px'}},[h('thead',[h('tr',['Tên thư mục','Đường dẫn trong nguồn','Trạng thái'].map(function(t){return h('th',{style:{textAlign:'left',padding:'12px',background:'#f2f6fa'}},t);}))]),h('tbody',rows.map(function(s){return h('tr',{key:s.id,on:{click:function(){self.selected=s;}},style:{background:self.selected&&self.selected.id===s.id?'#e3f2ff':'white',cursor:'pointer'}},[s.label,s.relative_path||'Thư mục gốc',s.enabled?'Đang bật':'Đã tắt'].map(function(t){return h('td',{style:{padding:'12px',borderBottom:'1px solid #e5ebef'}},t);}));}))]),!rows.length?h('p','Chưa có nguồn ảnh. Chọn Thêm thư mục để bắt đầu.'):null,
          this.directories?h('section',{style:{marginTop:'20px',padding:'16px',border:'1px solid #d4e0e9'}},[h('h3','Chọn thư mục trong nguồn đã cấp quyền'),h('p',this.folderPath||'Thư mục gốc'),button('Lên một cấp',function(){self.browse(self.folderPath.split('/').slice(0,-1).join('/'));},!this.folderPath),button('Đóng',function(){self.directories=null;}),h('ul',this.directories.folders.map(function(f){return h('li',{key:f.path,style:{margin:'8px 0'}},[button('📁 '+f.name,function(){self.browse(f.path);})]);})),input('label','Tên nguồn ảnh'),button('Bật thư mục này',this.add,!this.label.trim())]):null]);
      }
      return h('v-app-instance',{attrs:{'class-name':'SYNO.SDS.App.StudioGallery.Instance'}},[h('v-app-window',{ref:'window',attrs:{width:1080,height:680,resizable:true,'syno-id':'SYNO.SDS.App.StudioGallery.Window'}},[h('div',{style:{display:'flex',height:'100%',background:'#fff',color:'#33475b',fontFamily:'Arial,sans-serif'}},[h('aside',{style:{width:'190px',flexShrink:0,padding:'20px 12px',borderRight:'1px solid #dce5ed',background:'#f7f9fc'}},[h('img',{attrs:{src:base+'images/console_72.png',alt:'Studio Gallery Console'},style:{width:'40px',height:'40px'}}),h('h3','Studio Gallery Console')].concat([['overview','Tổng quan'],['folders','Thư mục nguồn']].map(function(n){return h('button',{attrs:{type:'button'},on:{click:function(){self.section=n[0];}},style:{display:'block',width:'100%',padding:'12px',textAlign:'left',marginTop:'8px',border:0,borderRadius:'4px',background:self.section===n[0]?'#dfefff':'transparent'}},n[1]);}))),h('section',{style:{flex:1,padding:'24px',overflow:'auto'}},[content,this.busy?h('p',{attrs:{role:'status'}},'Đang xử lý…'):null,this.error?h('p',{attrs:{role:'alert'},style:{color:'#b23d32',padding:'12px',background:'#fff0ec'}},this.error):null,this.notice?h('p',{attrs:{role:'status'},style:{color:'#26834a'}},this.notice):null])])])]);
    }
  });
}());
