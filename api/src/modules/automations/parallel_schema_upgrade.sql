ALTER TABLE automation_execution_tokens
    ADD COLUMN IF NOT EXISTS parallel_branch_id UUID;
ALTER TABLE automation_execution_parallel_groups
    ADD COLUMN IF NOT EXISTS parent_branch_id UUID;
