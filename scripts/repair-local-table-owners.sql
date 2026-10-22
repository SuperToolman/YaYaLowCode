-- Run as postgres against yaya_low_code. Only ownership changes; data is preserved.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE public.workflow_branch_tokens OWNER TO yaya;
ALTER TABLE public.form_data_d7d705d0_form_af68e47019894dd685ea79dfc84b_359140f4 OWNER TO yaya;
ALTER TABLE public.form_data_d7d705d0_form_c9ad0c3c94e443da82b824229e97_0488cede OWNER TO yaya;
COMMIT;
