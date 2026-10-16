import type {AnchorPlan} from './anchorCalibration.js';
import type {Snapshot} from './core.js';
/** Deterministic calculated overlay; colors are annotations, never image detections. */
export function annotatedAnchorScreenshot(png:Buffer,snapshot:Snapshot,plan:AnchorPlan,viewport:{width:number;height:number}){
 if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Captura PNG inválida.');
 const w=png.readUInt32BE(16),h=png.readUInt32BE(20);
 if(!Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||w!==viewport.width||h!==viewport.height)throw Error('Screenshot e viewport divergentes; não desenhar coordenadas sem calibração.');
 const b=snapshot.bounds;
 for(const p of [plan.red,plan.green])if(p.x<0||p.y<0||p.x>=w||p.y>=h)throw Error('Âncora fora da captura.');
 const line=(a:{x:number;y:number},z:{x:number;y:number},color:string)=>`<line x1="${a.x}" y1="${a.y}" x2="${z.x}" y2="${z.y}" stroke="${color}" stroke-width="3" marker-end="url(#arrow)"/>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#fff"/></marker></defs>
<image width="${w}" height="${h}" href="data:image/png;base64,${png.toString('base64')}"/>
<rect x="${b.left}" y="${b.top}" width="${b.right-b.left}" height="${b.bottom-b.top}" fill="none" stroke="#00d9ff" stroke-width="2"/>
<line x1="${plan.red.x}" y1="${plan.red.y}" x2="${plan.green.x}" y2="${plan.green.y}" stroke="#fff" stroke-width="1" stroke-dasharray="5 5"/>
${line(plan.finger1_start,plan.finger1_end,'#ff3030')}${line(plan.finger2_start,plan.finger2_end,'#00d060')}
<circle cx="${plan.red.x}" cy="${plan.red.y}" r="6" fill="#ff3030" stroke="#fff"/><circle cx="${plan.green.x}" cy="${plan.green.y}" r="6" fill="#00d060" stroke="#fff"/>
<rect x="0" y="0" width="${w}" height="35" fill="#111"/><text x="12" y="24" font-family="sans-serif" font-size="17" fill="#fff">Calculated anchors / ${plan.direction} / not Instagram controls</text></svg>`;
}
