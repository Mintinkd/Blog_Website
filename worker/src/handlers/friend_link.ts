import { Env } from "../index";
import {
  successResponse,
  error,
  ErrorCodes,
  notFound,
  parseJsonBody,
} from "../utils/response";
import { validate, isValidUrl } from "../utils/validator";
import { FRIEND_LINK_COLUMNS, FRIEND_LINK_ID_COLUMNS } from "../utils/columns";

export async function handleListFriendLinks(
  request: Request,
  env: Env
): Promise<Response> {
  const links = await env.DB.prepare(
    `
    SELECT id, name, url, description, logo_url FROM friend_links WHERE is_active = 1 ORDER BY sort_order ASC, id ASC
  `
  ).all();
  return successResponse(links.results);
}

export async function handleListAllFriendLinks(
  request: Request,
  env: Env
): Promise<Response> {
  const links = await env.DB.prepare(
    `SELECT ${FRIEND_LINK_COLUMNS} FROM friend_links ORDER BY sort_order ASC, id ASC`
  ).all();
  return successResponse(links.results);
}

export async function handleCreateFriendLink(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (body instanceof Response) return body;

  const result = validate(body, [
    {
      field: "name",
      required: true,
      type: "string",
      minLength: 1,
      maxLength: 100,
    },
    { field: "url", required: true, type: "string", minLength: 1 },
  ]);

  if (!result.valid) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      result.errors.map((e) => e.message).join("; ")
    );
  }

  if (!isValidUrl(String(body.url))) {
    return error(ErrorCodes.VALIDATION_FAILED, "Invalid URL format");
  }

  if (body.logo_url && String(body.logo_url).trim() !== "") {
    if (!isValidUrl(String(body.logo_url)))
      return error(ErrorCodes.VALIDATION_FAILED, "Invalid logo URL format");
  }

  const res = await env.DB.prepare(
    `
    INSERT INTO friend_links (name, url, description, logo_url, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  )
    .bind(
      body.name,
      body.url,
      body.description || "",
      body.logo_url || "",
      body.sort_order || 0,
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1
    )
    .run();

  const link = await env.DB.prepare(
    `SELECT ${FRIEND_LINK_COLUMNS} FROM friend_links WHERE id = ?`
  )
    .bind(res.meta.last_row_id)
    .first();
  return successResponse(link, "Friend link created");
}

export async function handleUpdateFriendLink(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  const { id } = params;
  const body = await parseJsonBody(request);
  if (body instanceof Response) return body;

  const existing = await env.DB.prepare(
    `SELECT ${FRIEND_LINK_ID_COLUMNS} FROM friend_links WHERE id = ?`
  )
    .bind(id)
    .first();
  if (!existing) return notFound("Friend link not found");

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    sets.push("name = ?");
    values.push(String(body.name));
  }
  if (body.url !== undefined) {
    if (!isValidUrl(String(body.url)))
      return error(ErrorCodes.VALIDATION_FAILED, "Invalid URL format");
    sets.push("url = ?");
    values.push(String(body.url));
  }
  if (body.description !== undefined) {
    sets.push("description = ?");
    values.push(String(body.description));
  }
  if (body.logo_url !== undefined) {
    if (
      String(body.logo_url).trim() !== "" &&
      !isValidUrl(String(body.logo_url))
    )
      return error(ErrorCodes.VALIDATION_FAILED, "Invalid logo URL format");
    sets.push("logo_url = ?");
    values.push(String(body.logo_url));
  }
  if (body.sort_order !== undefined) {
    sets.push("sort_order = ?");
    values.push(Number(body.sort_order));
  }
  if (body.is_active !== undefined) {
    sets.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  await env.DB.prepare(
    `UPDATE friend_links SET ${sets.join(", ")} WHERE id = ?`
  )
    .bind(...values)
    .run();

  const link = await env.DB.prepare(
    `SELECT ${FRIEND_LINK_COLUMNS} FROM friend_links WHERE id = ?`
  )
    .bind(id)
    .first();
  return successResponse(link, "Friend link updated");
}

export async function handleDeleteFriendLink(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  const { id } = params;
  const result = await env.DB.prepare("DELETE FROM friend_links WHERE id = ?")
    .bind(id)
    .run();
  if (result.meta.changes === 0) return notFound("Friend link not found");

  return successResponse(null, "Friend link deleted");
}
