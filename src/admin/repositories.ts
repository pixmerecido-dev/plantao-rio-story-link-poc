import type { StorySettings,PublicationJob,PublicationEvent } from './domain.js';
export interface SettingsRepository { getSettings():Promise<StorySettings>;saveSettings(settings:StorySettings):Promise<void> }
export interface PublicationsRepository {
  listJobs():Promise<PublicationJob[]>;findJob(id:string):Promise<PublicationJob|undefined>;saveJob(job:PublicationJob):Promise<void>;
  listEvents(jobId?:string):Promise<PublicationEvent[]>;appendEvent(event:PublicationEvent):Promise<void>;
  importPublication(job:PublicationJob,event:PublicationEvent):Promise<boolean>;
}
