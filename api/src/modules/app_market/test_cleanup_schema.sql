-- Minimal runtime tables for isolated destructive-reset verification only.
CREATE TABLE automation_flow_runs(id UUID PRIMARY KEY,flow_id UUID,workflow_instance_id UUID);
CREATE TABLE automation_flow_run_nodes(run_id UUID);
CREATE TABLE workflow_instances(id UUID PRIMARY KEY,form_uuid TEXT,process_flow_id UUID);
CREATE TABLE automation_execution_runs(run_id UUID);
CREATE TABLE automation_execution_audits(run_id UUID);
CREATE TABLE automation_execution_tokens(id UUID PRIMARY KEY,run_id UUID,instance_id UUID);
CREATE TABLE workflow_tasks(instance_id UUID);
CREATE TABLE workflow_actions(instance_id UUID);
CREATE TABLE workflow_branch_tokens(instance_id UUID);
CREATE TABLE workflow_notifications(id UUID PRIMARY KEY,instance_id UUID);
CREATE TABLE workflow_notification_dispatch(notification_id UUID);
CREATE TABLE workflow_comments(form_uuid TEXT);
CREATE TABLE form_recycle_bin_entries(form_uuid TEXT,detail_source_form_uuid TEXT);
CREATE TABLE iam_role_permissions(permission TEXT);
