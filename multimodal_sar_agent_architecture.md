# SARAH multimodal agent architecture

The architecture, graph/action contracts, ownership boundaries, Gemini model policy, implementation status, and acceptance checks are maintained in one place: [`plan.md`](./plan.md).

**Core rule:** Gemini owns multimodal interpretation, graph meaning, survivor assessment and marking, every movement decision, backtracking, and return. The graph is memory only. Local code stores the graph and simulates sensors, world physics, collisions, and hidden-truth grading; it does not choose routes or apply rescue-evidence gates.

Do not add a second architecture contract here. Update `plan.md` when the design changes.
