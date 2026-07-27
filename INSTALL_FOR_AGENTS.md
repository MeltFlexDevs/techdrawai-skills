# Install TechDraw AI (paste this into your agent)

> Set up the TechDraw AI skills and MCP server for me.
>
> 1. Run `npx -y skills add MeltFlexDevs/techdrawai-skills` to install the skills.
> 2. Register the MCP server with my client. For Claude Code that is
>    `claude mcp add techdrawai -- npx -y techdrawai-mcp`. For any other client,
>    read https://techdrawai.com/mcp and use the block for the one I am on.
> 3. Ask me for my TechDraw AI API key (`tda_sk_...`) and put it in the `env`
>    block as `TECHDRAWAI_API_KEY`, or tell me to run
>    `npx -y techdrawai-mcp auth login` if I would rather sign in through the
>    browser. Do not invent a key.
> 4. Verify with `npx -y techdrawai-mcp whoami`, which prints the account and
>    the plan.
>
> Programmatic access needs an active Studio plan. If the key is rejected with a
> plan error, tell me and stop rather than retrying.

## What gets installed

Two skills, `techdrawai-drafting` and `techdrawai-cad`, plus an MCP server exposing six tools: `generate_technical_drawing`, `image_to_dxf`, `render_product`, `photo_to_3d`, `identify_product` and `check_credits`.

## After it is set up

Try: *"Here is a photo of a bracket, `~/photos/bracket.jpg`. It is 120 mm across. Draw it to ISO A3 and give me a DXF at true size."*
