-- Destructive: remove retired page properties from every form schema version.
UPDATE form_schemas
SET schema_json = jsonb_set(schema_json, '{pageProps}',
    (schema_json->'pageProps') - ARRAY['formulaValidations', 'serviceValidations', 'customServiceValidations', 'stopRulesOnFailure', 'businessFailureRules', 'integrationAutomations', 'serviceExecutions', 'customServiceExecutions', 'beforeSubmitActions', 'afterSubmitActions', 'afterDataInitActions', 'dataSourceCode']::text[])
WHERE jsonb_typeof(schema_json->'pageProps') = 'object'
  AND (schema_json->'pageProps') ?| ARRAY['formulaValidations', 'serviceValidations', 'customServiceValidations', 'stopRulesOnFailure', 'businessFailureRules', 'integrationAutomations', 'serviceExecutions', 'customServiceExecutions', 'beforeSubmitActions', 'afterSubmitActions', 'afterDataInitActions', 'dataSourceCode']::text[];
