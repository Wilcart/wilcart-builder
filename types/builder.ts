export type BuilderProjectStatus = 'draft' | 'building' | 'deploying' | 'deployed' | 'error'
export type BuilderDeployStatus = 'pending' | 'in_progress' | 'ready' | 'error' | 'cancelled'
export type BuilderAIRole = 'user' | 'assistant' | 'system'

export interface BuilderProject {
  id: string
  org_id: string
  created_by: string
  name: string
  description: string | null
  framework: string
  status: BuilderProjectStatus
  netlify_site_id: string | null
  netlify_site_name: string | null
  netlify_deploy_id: string | null
  netlify_deploy_url: string | null
  netlify_deploy_status: BuilderDeployStatus | null
  last_deployed_at: string | null
  custom_domain_id: string | null
  custom_domain: string | null
  domain_connected: boolean
  meta_title: string | null
  meta_description: string | null
  active_file_id: string | null
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface BuilderFile {
  id: string
  project_id: string
  org_id: string
  path: string
  name: string
  mime_type: string
  content: string
  size_bytes: number
  is_entry: boolean
  created_at: string
  updated_at: string
}

export interface BuilderMessage {
  id: string
  project_id: string
  org_id: string
  role: BuilderAIRole
  content: string
  affected_file_ids: string[] | null
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

export interface BuilderDeployment {
  id: string
  project_id: string
  org_id: string
  triggered_by: string | null
  status: BuilderDeployStatus
  netlify_deploy_id: string | null
  netlify_deploy_url: string | null
  netlify_log_url: string | null
  error_message: string | null
  started_at: string
  completed_at: string | null
}

export interface DomainAvailability {
  domain: string
  available: boolean
  price: number
  currency: string
  period: number
}
