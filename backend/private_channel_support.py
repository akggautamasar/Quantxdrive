"""Extra peer resolution for the new Channels feature.

Telegram private channels cannot be resolved from an arbitrary numeric ID unless
that Telegram identity has a peer/access hash for the channel. The SESSION_STRING
account is the authoritative identity for private-channel access. This module
refreshes that account's dialogs before giving up on a numeric ID and handles
private invite links without involving the optional bot client.
"""

from fastapi import HTTPException


def _is_private_invite(target):
    value = str(target or "").strip().lower()
    return (
        value.startswith("+")
        or "t.me/+" in value
        or "t.me/joinchat/" in value
        or "telegram.me/+" in value
        or "telegram.me/joinchat/" in value
    )


def _invite_url(target):
    value = str(target or "").strip()
    if value.startswith("+"):
        return "https://t.me/" + value
    if value.startswith(("t.me/", "telegram.me/")):
        return "https://" + value
    return value


def install():
    """Install resolver behavior without touching any legacy channel code."""
    import channels_service as cs
    import main

    if getattr(cs, "_private_channel_support_installed", False):
        return

    original = cs._resolve_with_clients

    async def resolve(target):
        session = main.pyro_client
        if not session:
            raise HTTPException(status_code=503, detail="Telegram session is not ready")

        # Private invite links are user-session operations. Keep them out of the
        # bot fallback because a bot cannot use a user's private invite flow.
        if _is_private_invite(target):
            invite = _invite_url(target)
            errors = []

            try:
                chat = await session.get_chat(invite)
                if getattr(chat, "id", None) is not None:
                    print(f"📺 Private invite resolved to {chat.id}", flush=True)
                    return chat, session, "session"
            except Exception as exc:
                errors.append(f"lookup: {type(exc).__name__}: {exc}")

            try:
                chat = await session.join_chat(invite)
                if getattr(chat, "id", None) is not None:
                    print(f"📺 Private invite joined/resolved to {chat.id}", flush=True)
                    return chat, session, "session"
            except Exception as exc:
                text = str(exc)
                upper = text.upper()
                if "USER_ALREADY_PARTICIPANT" in upper or "ALREADY_PARTICIPANT" in upper:
                    try:
                        chat = await session.get_chat(invite)
                        if getattr(chat, "id", None) is not None:
                            return chat, session, "session"
                    except Exception as lookup_exc:
                        errors.append(f"already-member lookup: {lookup_exc}")
                elif "INVITE_REQUEST_SENT" in upper:
                    raise HTTPException(
                        status_code=409,
                        detail="Telegram join request was sent. Approve the SESSION_STRING account in Telegram, then add the channel again.",
                    )
                else:
                    errors.append(f"join: {type(exc).__name__}: {exc}")

            raise HTTPException(
                status_code=400,
                detail="Telegram could not resolve this private invite. Make sure the SESSION_STRING account has access and the invite is valid. " + " | ".join(errors),
            )

        # Numeric IDs need special handling. First use Pyrogram's normal cache.
        if isinstance(target, int):
            try:
                chat = await session.get_chat(target)
                if getattr(chat, "id", None) is not None:
                    return chat, session, "session"
            except Exception as first_error:
                print(f"📺 Numeric channel lookup needs peer refresh for {target}: {first_error}", flush=True)

            # Refresh the user's peer cache by enumerating all dialogs. This is
            # the key path for private numeric IDs when the account is already a
            # member but the peer was not cached when the Render instance started.
            try:
                async for dialog in session.get_dialogs():
                    chat = getattr(dialog, "chat", None)
                    if chat is None:
                        continue
                    try:
                        if int(chat.id) == int(target):
                            print(f"📺 Private channel ID {target} resolved from SESSION_STRING dialogs", flush=True)
                            return chat, session, "session"
                    except (TypeError, ValueError):
                        continue
            except Exception as exc:
                print(f"⚠️ Could not refresh Telegram dialogs for {target}: {exc}", flush=True)

            # Retry after the dialog walk; Pyrogram may now have the access hash.
            try:
                chat = await session.get_chat(target)
                if getattr(chat, "id", None) is not None:
                    print(f"📺 Private channel ID {target} resolved after peer refresh", flush=True)
                    return chat, session, "session"
            except Exception as exc:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Telegram could not access channel ID {target}. The SESSION_STRING account must be a member of this private channel. "
                        "If it is already a member, open the channel once with that same Telegram account and try the ID again. "
                        f"Telegram error: {exc}"
                    ),
                )

        # Public username/other identifiers retain the existing Channels resolver,
        # including its optional bot fallback.
        return await original(target)

    cs._resolve_with_clients = resolve
    cs._private_channel_support_installed = True
