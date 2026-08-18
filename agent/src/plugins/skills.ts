import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentRequestContext, AgentSkill, AgentSkills } from "../contracts.js";

type SkillsConfig = { skills?: AgentSkill[] };

export class SkillsService extends Service implements AgentSkills {
  private readonly skills: AgentSkill[];

  constructor(ctx: Context, config: SkillsConfig = {}) {
    super(ctx, "skills");
    const environment = process.env.AGENT_SKILLS_JSON ? JSON.parse(process.env.AGENT_SKILLS_JSON) as SkillsConfig : {};
    this.skills = [...(environment.skills ?? []), ...(config.skills ?? [])]
      .filter((skill) => skill.id && skill.name && skill.instructions)
      .map((skill) => ({ ...skill, enabled: skill.enabled !== false }));
  }

  list(_context: AgentRequestContext) { return this.skills.filter((skill) => skill.enabled); }

  instructions(context: AgentRequestContext) {
    const enabled = this.list(context);
    return enabled.length ? enabled.map((skill) => `## ${skill.name}\n${skill.instructions}`).join("\n\n") : undefined;
  }
}
