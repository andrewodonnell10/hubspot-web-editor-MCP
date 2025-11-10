/**
 * Type definitions for HubSpot CMS MCP Server
 */

export interface HubSpotConfig {
  accessToken: string;
  rateLimitSafetyMargin: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface RateLimitStatus {
  dailyRemaining: number;
  burstRemaining: number;
  dailyPercentUsed: number;
  burstPercentUsed: number;
}

export interface HubSpotError {
  status: string;
  message: string;
  correlationId: string;
  category?: string;
  subCategory?: string;
  errors?: Array<{
    message: string;
    in?: string;
  }>;
}

export interface HubSpotResponse<T> {
  success: boolean;
  data?: T;
  error?: HubSpotError;
  rateLimitStatus?: RateLimitStatus;
}

export interface TokenValidationResponse {
  token: string;
  user: string;
  hub_domain: string;
  hub_id: number;
  app_id: number;
  expires_at: number;
  user_id: number;
  token_type: string;
  scopes: string[];
}

export interface BlogPost {
  id: string;
  name: string;
  slug: string;
  state: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';
  currentState?: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';
  postBody?: string;
  metaDescription?: string;
  featuredImage?: string;
  featuredImageAltText?: string;
  authorName?: string;
  blogAuthorId?: string;
  tagIds?: number[];
  publishDate?: string;
  created?: string;
  updated?: string;
  url?: string;
  previewKey?: string;
  htmlTitle?: string;
  pageExpiryEnabled?: boolean;
  pageExpiryDate?: number;
  pageExpiryRedirectUrl?: string;
  absoluteUrl?: string;
  archivedInDashboard?: boolean;
  currentlyPublished?: boolean;
  publicAccessRulesEnabled?: boolean;
  publicAccessRules?: any[];
  widgetContainers?: any;
  widgets?: any;
  layoutSections?: any;
}

export interface BlogPostListParams {
  limit?: number;
  offset?: number;
  state?: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';
  authorName?: string;
  name?: string;
  created?: string;
  updated?: string;
  archivedInDashboard?: boolean;
}

export interface PaginatedResponse<T> {
  total: number;
  results: T[];
  offset?: number;
  limit?: number;
}

export interface BlogPostUpdateMetadata {
  name?: string;
  slug?: string;
  metaDescription?: string;
  htmlTitle?: string;
  featuredImage?: string;
  featuredImageAltText?: string;
  blogAuthorId?: string;
  authorName?: string;
  tagIds?: number[];
}

export interface PublishOptions {
  publishDate?: string; // ISO 8601 format for scheduled publishing
}

export interface OperationResult {
  success: boolean;
  contentId?: string;
  previewUrl?: string;
  message: string;
  rateLimitStatus: RateLimitStatus;
  timestamp: string;
}
