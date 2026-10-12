import { createServer,type IncomingMessage,type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,join,dirname } from 'node:path';
import { PUBLICATION_STATUSES,REFERENCE,ADMIN_TIMEZONE,ValidationError } from './domain.js';
import { StorySettingsService } from './storySettingsService.js';
import { PublicationsService } from './publicationsService.js';
import { ArtifactImporter } from './artifactImporter.js';
import type { SettingsRepository,PublicationsRepository } from './repositories.js';
import { resolveStoryMedia } from '../media/resolveStoryMedia.js';
import { shellHtml,adminCss } from './view.js';
class HttpError extends Error { constructor(public readonly status:number,message:string){ super(message); } }
async function body(req:IncomingMessage){
  if(!req.headers['content-type']?.startsWith('application/json') || req.headers['x-admin-request']!=='local')throw new HttpError(415,'Envie JSON pelo painel local.');
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){ size+=chunk.length;if(size>64*1024)throw new HttpError(413,'Requisição muito grande.');chunks.push(chunk); }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'JSON inválido.');}
}
export function createAdminServer(options:{ repository:SettingsRepository & PublicationsRepository;root:string;previewPath?:string;artifactDirectory?:string;clientPath?:string }){
  const settings=new StorySettingsService(options.repository),publications=new PublicationsService(options.repository);
  const importer=new ArtifactImporter(options.repository,options.artifactDirectory ?? join(options.root,'artifacts'));
  const send=(res:ServerResponse,value:unknown,status=200)=>{res.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store' });res.end(JSON.stringify(value));};
  const image=async(res:ServerResponse,path:string)=>{
    const media=await resolveStoryMedia(path);if(media.type!=='IMAGE')throw new HttpError(404,'Miniatura de imagem indisponível.');
    if(media.size>32*1024*1024)throw new HttpError(413,'Imagem grande demais para preview.');
    res.writeHead(200,{ 'Content-Type':media.mimeType,'Cache-Control':'no-store' });res.end(await readFile(media.path));
  };
  return createServer((req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    void (async()=>{
      const port=req.socket.localPort;
      const host=req.headers.host;
      if(!host || ![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))throw new HttpError(403,'Host local obrigatório.');
      if(req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin))throw new HttpError(403,'Origem não permitida.');
      const url=new URL(req.url??'/','http://127.0.0.1'),method=req.method??'GET';
      if(method==='GET' && url.pathname==='/'){res.writeHead(200,{ 'Content-Type':'text/html; charset=utf-8' });res.end(shellHtml);return;}
      if(method==='GET' && url.pathname==='/assets/admin.css'){res.writeHead(200,{ 'Content-Type':'text/css; charset=utf-8' });res.end(adminCss);return;}
      if(method==='GET' && url.pathname==='/assets/domain.js'){res.writeHead(200,{ 'Content-Type':'application/javascript; charset=utf-8' });res.end(await readFile(join(dirname(options.clientPath??join(options.root,'dist/admin/client.js')),'domain.js'),'utf8'));return;}
      if(method==='GET' && url.pathname==='/assets/client.js'){res.writeHead(200,{ 'Content-Type':'application/javascript; charset=utf-8' });res.end(await readFile(options.clientPath??join(options.root,'dist/admin/client.js'),'utf8'));return;}
      if(method==='GET' && url.pathname==='/api/meta'){send(res,{ reference:REFERENCE,timezone:ADMIN_TIMEZONE,engineConnected:false,layoutTestAvailable:false });return;}
      if(method==='GET' && url.pathname==='/api/settings'){send(res,await settings.getSettings());return;}
      if(method==='PUT' && url.pathname==='/api/settings'){send(res,await settings.save(await body(req)));return;}
      if(method==='POST' && url.pathname==='/api/settings/reset'){await body(req);send(res,await settings.restoreDefaults());return;}
      if(method==='GET' && url.pathname==='/api/dashboard'){const imported=await importer.sync();send(res,{ ...await publications.dashboard(),imported });return;}
      if(method==='GET' && url.pathname==='/api/publications'){
        const status=url.searchParams.get('status')??'',type=url.searchParams.get('type')??'',search=url.searchParams.get('q')??'',page=Number(url.searchParams.get('page')??1);
        if(status && !PUBLICATION_STATUSES.includes(status as never) || type && !['IMAGE','VIDEO','UNSUPPORTED'].includes(type) || !Number.isInteger(page) || page<1 || search.length>200)throw new HttpError(400,'Filtros inválidos.');
        await importer.sync();send(res,await publications.list({ status,type,search,page }));return;
      }
      if(method==='GET' && url.pathname==='/api/events'){await importer.sync();send(res,await publications.events(url.searchParams.get('job_id')??undefined));return;}
      if(method==='GET' && url.pathname==='/api/preview'){await image(res,options.previewPath??join(options.root,'assets/story-test.jpg'));return;}
      const match=/^\/api\/publications\/([^/]+)(\/media)?$/.exec(url.pathname);
      if(method==='GET' && match){const detail=await publications.detail(decodeURIComponent(match[1]!));if(!detail)throw new HttpError(404,'Publicação não encontrada.');
        if(match[2]){if(!detail.job.media_path || detail.job.media_type!=='IMAGE')throw new HttpError(404,'Miniatura indisponível.');await image(res,detail.job.media_path);}else send(res,detail);return;
      }
      throw new HttpError(404,'Recurso não disponível.'); // Não existe endpoint de execução/publicação.
    })().catch(error=>{
      if(res.headersSent){res.destroy();return;}
      const status=error instanceof HttpError ? error.status : error instanceof ValidationError ? 400 : 500;
      if(status===500)console.error('[ADMIN] Falha na requisição:',error);
      send(res,{ error:status===500 ? 'Não foi possível concluir a operação local.' : String(error.message??error) },status);
    });
  });
}
