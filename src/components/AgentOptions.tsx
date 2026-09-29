import { AGENTS } from "../lib/agents";

/** One `<option>` per supported agent, for every agent `<select>`. */
export const AgentOptions = () =>
  AGENTS.map((agent) => (
    <option key={agent.id} value={agent.id}>
      {agent.label}
    </option>
  ));
