import { lazy } from 'react';
import { preparedResource } from '../prepared-resource.ts';

export const composerResource = preparedResource(() => import('./CardComposer.tsx').then(module => ({ default: module.CardComposer })));
export const CardComposer = lazy(composerResource.load);
