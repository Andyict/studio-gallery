import {Aperture} from 'lucide-react';

export default function BrandMark({logoUrl}:{logoUrl?:string|null}){
  return logoUrl?<img className="brand-logo" src={logoUrl} alt="Logo studio"/>:<Aperture/>;
}
