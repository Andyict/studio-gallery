import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
export default {
  output:'standalone', outputFileTracingRoot:path.join(dir,'..'), poweredByHeader:false,
  async rewrites(){return [{source:'/api/:path*',destination:`${process.env.API_INTERNAL_URL||'http://127.0.0.1:3211'}/api/:path*`}];},
  async headers(){return [{source:'/:path*',headers:[{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Content-Type-Options',value:'nosniff'},{key:'X-Frame-Options',value:'DENY'}]}];}
};

