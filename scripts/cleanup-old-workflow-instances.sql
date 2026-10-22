BEGIN;
LOCK TABLE workflow_instances, workflow_tasks, automation_flow_runs IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE old_workflow_scope ON COMMIT DROP AS
SELECT i.* FROM workflow_instances i
WHERE NOT EXISTS (
    SELECT 1 FROM automation_flow_runs r JOIN automation_execution_runs e ON e.run_id=r.id
    WHERE r.workflow_instance_id=i.id
);
CREATE TEMP TABLE old_workflow_runs ON COMMIT DROP AS
SELECT id FROM automation_flow_runs WHERE workflow_instance_id IN (SELECT id FROM old_workflow_scope);
SELECT jsonb_build_object('instances',(SELECT count(*) FROM old_workflow_scope),
    'tasks',(SELECT count(*) FROM workflow_tasks WHERE instance_id IN (SELECT id FROM old_workflow_scope)),
    'runs',(SELECT count(*) FROM old_workflow_runs)) AS cleanup_inventory;
-- Reset only the latest unfinished instance for a record. A later terminal
-- result or any new-engine instance must not be overwritten.
DO $$
DECLARE item RECORD;
BEGIN
    FOR item IN
        SELECT i.form_uuid,i.record_uuid,s.physical_table
        FROM old_workflow_scope i
        JOIN form_storage_definitions s ON s.form_uuid=i.form_uuid
        WHERE i.completed_at IS NULL AND i.status NOT IN ('completed','rejected','reversed','cancelled')
          AND NOT EXISTS(SELECT 1 FROM workflow_instances n WHERE n.form_uuid=i.form_uuid
              AND n.record_uuid=i.record_uuid AND (n.started_at,n.id)>(i.started_at,i.id))
    LOOP
        IF item.physical_table !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
            RAISE EXCEPTION 'invalid business table identifier';
        END IF;
        EXECUTE format('UPDATE %I SET extension_data=(extension_data - ''workflowCurrentApprovalNode'') || jsonb_build_object(''workflowApprovalStatus'',''saved'',''workflowInstanceStatus'',''saved''),updated_by=''系统'',updated_at=NOW() WHERE record_uuid=$1',item.physical_table)
            USING item.record_uuid;
    END LOOP;
END $$;
UPDATE im_business_message_bindings SET status='invalidated'
WHERE business_id IN (SELECT id FROM old_workflow_scope)
   OR business_id IN (SELECT id FROM workflow_tasks WHERE instance_id IN (SELECT id FROM old_workflow_scope));
DELETE FROM workflow_notifications WHERE instance_id IN (SELECT id FROM old_workflow_scope);
DELETE FROM workflow_actions WHERE instance_id IN (SELECT id FROM old_workflow_scope);
DELETE FROM workflow_comments c WHERE EXISTS(SELECT 1 FROM old_workflow_scope i WHERE i.form_uuid=c.form_uuid AND i.record_uuid=c.record_uuid)
    AND NOT EXISTS(SELECT 1 FROM workflow_instances n WHERE n.form_uuid=c.form_uuid AND n.record_uuid=c.record_uuid AND n.id NOT IN (SELECT id FROM old_workflow_scope));
DELETE FROM workflow_tasks WHERE instance_id IN (SELECT id FROM old_workflow_scope);
DELETE FROM workflow_branch_tokens WHERE instance_id IN (SELECT id FROM old_workflow_scope);
DELETE FROM automation_flow_run_nodes WHERE run_id IN (SELECT id FROM old_workflow_runs);
DELETE FROM automation_flow_runs WHERE id IN (SELECT id FROM old_workflow_runs);
DELETE FROM workflow_instances WHERE id IN (SELECT id FROM old_workflow_scope);
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM workflow_tasks t LEFT JOIN workflow_instances i ON i.id=t.instance_id WHERE i.id IS NULL) THEN
        RAISE EXCEPTION 'orphan workflow task';
    END IF;
    IF EXISTS(SELECT 1 FROM workflow_tasks t LEFT JOIN automation_execution_tokens e ON e.id=t.branch_token_id WHERE t.branch_token_id IS NOT NULL AND e.id IS NULL) THEN
        RAISE EXCEPTION 'orphan common token';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='workflow_tasks'::regclass AND conname='workflow_tasks_branch_token_common_fkey') THEN
        ALTER TABLE workflow_tasks ADD CONSTRAINT workflow_tasks_branch_token_common_fkey
            FOREIGN KEY(branch_token_id) REFERENCES automation_execution_tokens(id) ON DELETE SET NULL;
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_human_task_visit_assignee ON workflow_tasks(branch_token_id,node_key,assignee_user_id) WHERE branch_token_id IS NOT NULL AND assignee_user_id IS NOT NULL;
COMMIT;
