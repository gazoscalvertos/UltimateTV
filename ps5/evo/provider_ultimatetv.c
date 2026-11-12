/*
 * provider_ultimatetv.c - UltimateTV behind EVO Player's evo_provider_t vtable.
 *
 * This file is built INTO an EVO Player tree (see ps5/evo/README.md and docs/ps5-architecture.md);
 * it is not a program on its own. It is deliberately thin: the Hub's /api/ps5 routes return rows
 * already shaped like evo_provider_item_t and streams shaped like evo_stream_choice_t, so this file
 * only moves JSON into those structs. The logic, and the tests, are in hub/src/ps5.ts.
 *
 * Look: the Hub serves an RmlUi bundle at /ps5/bundle/ (ui_bundle_url), generated from the TV's
 * own theme. With no Hub yet, EVO's embedded "mediaserver" skin is the fallback.
 *
 * Config (key=value, first file found wins): /data/evoplayer/ultimatetv.conf,
 * /download0/evoplayer/ultimatetv.conf, /mnt/usb0/.evo_ultimatetv.conf
 *     hub=http://192.168.0.19:8095
 *     token=...         written by this file once the Hub lets the console in
 *
 * Every network call is asynchronous through evo_net_request_async and completes on the main
 * thread, as evo_provider.h requires. Nothing here blocks the 60 Hz loop.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "evo_net.h"
#include "evo_provider.h"

#define CONF_PATHS_N 3
static const char *const CONF_PATHS[CONF_PATHS_N] = {
    "/data/evoplayer/ultimatetv.conf",
    "/download0/evoplayer/ultimatetv.conf",
    "/mnt/usb0/.evo_ultimatetv.conf",
};

/* Where the Hub is when no config file says. Override at build time with -DUTV_DEFAULT_HUB='"http://host:8095"'. */
#ifndef UTV_DEFAULT_HUB
#define UTV_DEFAULT_HUB "http://192.168.0.19:8095"
#endif

static struct {
    char hub[256];      /* http://host:port, no trailing slash */
    char token[128];    /* X-Device-Token, once paired */
    char request[64];   /* a pairing request the Hub is holding for approval */
    char secret[64];
    char bundle[300];   /* hub + "/ps5/bundle", what ui_bundle_url returns */
    int  loaded;
    int  writable;      /* index into CONF_PATHS to save to, or -1 */
} g;

/* ------------------------------------------------------------------------- */
/* Config                                                                    */
/* ------------------------------------------------------------------------- */

static void copy(char *dst, size_t cap, const char *src)
{
    snprintf(dst, cap, "%s", src ? src : "");
}

static void trim_hub(void)
{
    size_t n = strlen(g.hub);
    while (n > 0 && (g.hub[n - 1] == '/' || g.hub[n - 1] == ' ')) g.hub[--n] = 0;
    if (g.hub[0] && strncmp(g.hub, "http://", 7) != 0 && strncmp(g.hub, "https://", 8) != 0) {
        char tmp[256];
        snprintf(tmp, sizeof tmp, "http://%s", g.hub);
        copy(g.hub, sizeof g.hub, tmp);
    }
    if (g.hub[0]) snprintf(g.bundle, sizeof g.bundle, "%s/ps5/bundle", g.hub);
    else g.bundle[0] = 0;
}

static int load(void)
{
    memset(&g, 0, sizeof g);
    g.writable = -1;
    for (int i = 0; i < CONF_PATHS_N; i++) {
        FILE *f = fopen(CONF_PATHS[i], "rb");
        if (!f) continue;
        char line[512];
        while (fgets(line, sizeof line, f)) {
            char *eq = strchr(line, '=');
            if (!eq) continue;
            *eq = 0;
            char *v = eq + 1;
            v[strcspn(v, "\r\n")] = 0;
            if (!strcmp(line, "hub")) copy(g.hub, sizeof g.hub, v);
            else if (!strcmp(line, "token")) copy(g.token, sizeof g.token, v);
        }
        fclose(f);
        g.writable = i;
        break;
    }
    if (!g.hub[0]) copy(g.hub, sizeof g.hub, UTV_DEFAULT_HUB);
    trim_hub();
    g.loaded = 1;
    return 0;
}

static void save(void)
{
    for (int i = (g.writable >= 0 ? g.writable : 0); i < CONF_PATHS_N; i++) {
        FILE *f = fopen(CONF_PATHS[i], "wb");
        if (!f) continue;
        fprintf(f, "hub=%s\ntoken=%s\n", g.hub, g.token);
        fclose(f);
        g.writable = i;
        return;
    }
}

/* ------------------------------------------------------------------------- */
/* One request to the Hub                                                    */
/* ------------------------------------------------------------------------- */

typedef void (*hub_done)(int ok, int status, cJSON *json, void *ud);

typedef struct { hub_done done; void *ud; } hub_call;

static void hub_cb(int success, int status, const char *body, size_t len, void *user)
{
    hub_call *c = user;
    cJSON *json = (success && body && len) ? cJSON_ParseWithLength(body, len) : NULL;
    c->done(success && status >= 200 && status < 300, status, json, c->ud);
    if (json) cJSON_Delete(json);
    free(c);
}

static int hub_request(const char *method, const char *path, const char *body, hub_done done, void *ud)
{
    if (!g.hub[0]) return -1;
    hub_call *c = calloc(1, sizeof *c);
    if (!c) return -1;
    c->done = done;
    c->ud = ud;

    char url[EVO_PROVIDER_MAX_URL];
    snprintf(url, sizeof url, "%s%s", g.hub, path);

    char token_header[160];
    const char *headers[2];
    int n = 0;
    if (body) headers[n++] = "Content-Type: application/json";
    if (g.token[0]) {
        snprintf(token_header, sizeof token_header, "X-Device-Token: %s", g.token);
        headers[n++] = token_header;
    }
    int rc = evo_net_request_async(method, url, body, headers, n, hub_cb, c);
    if (rc < 0) free(c);
    return rc;
}

/* A tiny percent-encoder for the query strings we build. */
static void encode(char *out, size_t cap, const char *in)
{
    static const char hex[] = "0123456789ABCDEF";
    size_t o = 0;
    for (; in && *in && o + 4 < cap; in++) {
        unsigned char ch = (unsigned char)*in;
        if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.' || ch == '~') out[o++] = (char)ch;
        else { out[o++] = '%'; out[o++] = hex[ch >> 4]; out[o++] = hex[ch & 15]; }
    }
    out[o] = 0;
}

/* ------------------------------------------------------------------------- */
/* JSON to EVO's structs                                                     */
/* ------------------------------------------------------------------------- */

static void jstr(char *dst, size_t cap, const cJSON *obj, const char *key)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(obj, key);
    copy(dst, cap, cJSON_IsString(v) ? v->valuestring : "");
}
static double jnum(const cJSON *obj, const char *key)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(obj, key);
    return cJSON_IsNumber(v) ? v->valuedouble : 0;
}
static int jbool(const cJSON *obj, const char *key)
{
    return cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(obj, key));
}

static evo_media_kind_t kind_of(const char *k)
{
    if (!strcmp(k, "channel")) return EVO_MEDIA_STREAM;
    return EVO_MEDIA_VIDEO;
}

static void fill_item(evo_provider_item_t *it, const cJSON *r)
{
    char kind[16];
    memset(it, 0, sizeof *it);
    jstr(it->id, sizeof it->id, r, "id");
    jstr(it->parent_id, sizeof it->parent_id, r, "parent_id");
    jstr(it->title, sizeof it->title, r, "title");
    jstr(it->subtitle, sizeof it->subtitle, r, "subtitle");
    jstr(it->overview, sizeof it->overview, r, "overview");
    jstr(it->art_url, sizeof it->art_url, r, "art_url");
    jstr(it->backdrop_url, sizeof it->backdrop_url, r, "backdrop_url");
    jstr(it->logo_url, sizeof it->logo_url, r, "logo_url");
    jstr(it->rating, sizeof it->rating, r, "rating");
    jstr(it->cert, sizeof it->cert, r, "cert");
    jstr(it->facts, sizeof it->facts, r, "facts");
    jstr(it->now_title, sizeof it->now_title, r, "now_title");
    jstr(it->next_title, sizeof it->next_title, r, "next_title");
    jstr(kind, sizeof kind, r, "kind");
    it->duration_sec = (int64_t)jnum(r, "duration_sec");
    /* -1 from the Hub means "partly watched, the real point comes with resolve". */
    it->resume_pos_sec = jnum(r, "resume_pos_sec") > 0 ? (int64_t)jnum(r, "resume_pos_sec") : 0;
    it->kind = kind_of(kind);
    it->is_folder = jbool(r, "is_folder");
    it->is_live = jbool(r, "is_live");
    it->played = jbool(r, "played");
    it->detail = 0;
}

/* ------------------------------------------------------------------------- */
/* Pairing (the CAP_AUTH slot)                                               */
/* ------------------------------------------------------------------------- */

typedef struct { evo_provider_auth_cb cb; void *ud; } auth_ctx;

static void pair_done(int ok, int status, cJSON *json, void *ud)
{
    auth_ctx *a = ud;
    const cJSON *tok = json ? cJSON_GetObjectItemCaseSensitive(json, "token") : NULL;
    if (ok && cJSON_IsString(tok) && tok->valuestring[0]) {
        copy(g.token, sizeof g.token, tok->valuestring);
        g.request[0] = g.secret[0] = 0;
        save();
        a->cb(1, "Paired with the Hub", a->ud);
    } else if (status == 202 && json) {
        /* Another screen is already paired, so the Hub wants a "yes" from it. */
        const cJSON *id = cJSON_GetObjectItemCaseSensitive(json, "id");
        const cJSON *sec = cJSON_GetObjectItemCaseSensitive(json, "secret");
        if (cJSON_IsString(id)) copy(g.request, sizeof g.request, id->valuestring);
        if (cJSON_IsString(sec)) copy(g.secret, sizeof g.secret, sec->valuestring);
        a->cb(0, "Approve this PlayStation on the TV: Settings > Phones and remotes", a->ud);
    } else {
        a->cb(0, "Couldn't reach the Hub. Check hub= in ultimatetv.conf", a->ud);
    }
    free(a);
}

static int ut_auth(evo_provider_auth_cb cb, void *ud)
{
    auth_ctx *a = calloc(1, sizeof *a);
    if (!a) return -1;
    a->cb = cb;
    a->ud = ud;
    char path[160], body[200];
    int rc;
    if (g.request[0]) {
        snprintf(path, sizeof path, "/api/pair/screen/%s", g.request);
        snprintf(body, sizeof body, "{\"secret\":\"%s\"}", g.secret);
    } else {
        snprintf(path, sizeof path, "/api/pair/screen");
        snprintf(body, sizeof body, "{\"name\":\"PlayStation 5\"}");
    }
    rc = hub_request("POST", path, body, pair_done, a);
    if (rc < 0) free(a);
    return rc;
}

/* ------------------------------------------------------------------------- */
/* Catalogue and search                                                      */
/* ------------------------------------------------------------------------- */

typedef struct {
    evo_provider_items_cb cb;
    void *ud;
    char path[EVO_PROVIDER_MAX_URL];
    int retried;
} list_ctx;

static void list_go(list_ctx *c);

static void list_done(int ok, int status, cJSON *json, void *ud);

static void list_repaired(int ok, const char *msg, void *ud)
{
    list_ctx *c = ud;
    (void)msg;
    if (ok) list_go(c);
    else { c->cb(0, NULL, 0, 0, c->ud); free(c); }
}

static void list_done(int ok, int status, cJSON *json, void *ud)
{
    list_ctx *c = ud;
    if (!ok && (status == 401 || status == 403) && !c->retried) {
        /* Not paired, or the Hub forgot us: pair again, then ask once more. */
        c->retried = 1;
        g.token[0] = 0;
        if (ut_auth(list_repaired, c) >= 0) return;
    }
    const cJSON *items = json ? cJSON_GetObjectItemCaseSensitive(json, "items") : NULL;
    if (!ok || !cJSON_IsArray(items)) { c->cb(0, NULL, 0, 0, c->ud); free(c); return; }

    int n = cJSON_GetArraySize(items);
    if (n > EVO_PROVIDER_PAGE_MAX) n = EVO_PROVIDER_PAGE_MAX;
    evo_provider_item_t *out = calloc((size_t)(n ? n : 1), sizeof *out);
    if (!out) { c->cb(0, NULL, 0, 0, c->ud); free(c); return; }
    for (int i = 0; i < n; i++) fill_item(&out[i], cJSON_GetArrayItem(items, i));
    c->cb(1, out, n, jbool(json, "has_more"), c->ud);
    free(out);
    free(c);
}

static void list_go(list_ctx *c)
{
    if (hub_request("GET", c->path, NULL, list_done, c) < 0) { c->cb(0, NULL, 0, 0, c->ud); free(c); }
}

static int start_list(const char *path, evo_provider_items_cb cb, void *ud)
{
    if (!g.hub[0]) return -1;
    list_ctx *c = calloc(1, sizeof *c);
    if (!c) return -1;
    c->cb = cb;
    c->ud = ud;
    copy(c->path, sizeof c->path, path);
    if (!g.token[0]) {
        c->retried = 1;
        if (ut_auth(list_repaired, c) < 0) { free(c); return -1; }
        return 0;
    }
    if (hub_request("GET", c->path, NULL, list_done, c) < 0) { free(c); return -1; }
    return 0;
}

static int ut_list(const char *parent, int page, evo_provider_items_cb cb, void *ud)
{
    char enc[400], path[480];
    (void)page; /* the Hub sends a whole Home at once; series are short */
    encode(enc, sizeof enc, parent ? parent : "");
    snprintf(path, sizeof path, "/api/ps5/catalog?parent=%s", enc);
    return start_list(path, cb, ud);
}

static int ut_search(const char *q, int page, evo_provider_items_cb cb, void *ud)
{
    char enc[400], path[480];
    (void)page;
    encode(enc, sizeof enc, q);
    snprintf(path, sizeof path, "/api/ps5/search?q=%s", enc);
    return start_list(path, cb, ud);
}

/* ------------------------------------------------------------------------- */
/* Playing                                                                   */
/* ------------------------------------------------------------------------- */

typedef struct { evo_provider_resolve_cb cb; void *ud; } resolve_ctx;

static void resolve_done(int ok, int status, cJSON *json, void *ud)
{
    resolve_ctx *c = ud;
    (void)status;
    const cJSON *list = json ? cJSON_GetObjectItemCaseSensitive(json, "choices") : NULL;
    int n = cJSON_IsArray(list) ? cJSON_GetArraySize(list) : 0;
    if (!ok || n < 1) { c->cb(0, NULL, 0, c->ud); free(c); return; }
    if (n > 8) n = 8;
    evo_stream_choice_t *out = calloc((size_t)n, sizeof *out);
    if (!out) { c->cb(0, NULL, 0, c->ud); free(c); return; }
    for (int i = 0; i < n; i++) {
        const cJSON *r = cJSON_GetArrayItem(list, i);
        jstr(out[i].url, sizeof out[i].url, r, "url");
        jstr(out[i].label, sizeof out[i].label, r, "label");
        jstr(out[i].container, sizeof out[i].container, r, "container");
        jstr(out[i].video_range, sizeof out[i].video_range, r, "video_range");
        jstr(out[i].headers, sizeof out[i].headers, r, "headers");
        jstr(out[i].sub_url, sizeof out[i].sub_url, r, "sub_url");
        out[i].width = (int)jnum(r, "width");
        out[i].height = (int)jnum(r, "height");
        out[i].is_live = jbool(r, "is_live");
    }
    c->cb(1, out, n, c->ud);
    free(out);
    free(c);
}

static int ut_resolve(const char *id, evo_provider_resolve_cb cb, void *ud)
{
    resolve_ctx *c = calloc(1, sizeof *c);
    if (!c) return -1;
    c->cb = cb;
    c->ud = ud;
    char body[EVO_PROVIDER_MAX_ITEM_ID + 32];
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "id", id ? id : "");
    char *text = cJSON_PrintUnformatted(o);
    cJSON_Delete(o);
    snprintf(body, sizeof body, "%s", text ? text : "{}");
    free(text);
    int rc = hub_request("POST", "/api/ps5/resolve", body, resolve_done, c);
    if (rc < 0) free(c);
    return rc;
}

static void ignore(int ok, int status, cJSON *json, void *ud) { (void)ok; (void)status; (void)json; (void)ud; }

static void ut_progress(const char *id, int64_t pos, int64_t dur, evo_provider_play_state_t st)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "id", id ? id : "");
    cJSON_AddNumberToObject(o, "pos_sec", (double)pos);
    cJSON_AddNumberToObject(o, "dur_sec", (double)dur);
    cJSON_AddStringToObject(o, "state", st == EVO_PROVIDER_PLAY_START ? "start" : st == EVO_PROVIDER_PLAY_STOP ? "stop" : "update");
    cJSON_AddBoolToObject(o, "paused", evo_provider_is_paused());
    char *text = cJSON_PrintUnformatted(o);
    cJSON_Delete(o);
    if (text) hub_request("POST", "/api/ps5/progress", text, ignore, NULL);
    free(text);
}

/* ------------------------------------------------------------------------- */
/* The vtable                                                                */
/* ------------------------------------------------------------------------- */

static int ut_init(void)              { return load(); }
static void ut_shutdown(void)         { }
static int ut_configured(void)        { return g.hub[0] != 0; }
static int ut_needs_sign_in(void)     { return 0; /* pairing is automatic: see list_done */ }
static const char *ut_bundle(void)    { return g.bundle[0] ? g.bundle : NULL; }
static const char *ut_get_source(void){ return g.hub; }

static int ut_set_source(const char *v)
{
    copy(g.hub, sizeof g.hub, v);
    g.token[0] = g.request[0] = g.secret[0] = 0;
    trim_hub();
    save();
    return 0;
}

const evo_provider_t evo_provider_ultimatetv = {
    .id              = "ultimatetv",
    .name            = "UltimateTV",
    .icon            = NULL,
    .caps            = EVO_PROVIDER_CAP_CATALOG | EVO_PROVIDER_CAP_SEARCH |
                       EVO_PROVIDER_CAP_RESOLVE | EVO_PROVIDER_CAP_PROGRESS |
                       EVO_PROVIDER_CAP_AUTH | EVO_PROVIDER_CAP_UI |
                       EVO_PROVIDER_CAP_CONFIG,
    .api_version     = EVO_PROVIDER_API_VERSION,
    .init            = ut_init,
    .shutdown        = ut_shutdown,
    .is_configured   = ut_configured,
    .auth            = ut_auth,
    .list_catalog    = ut_list,
    .search          = ut_search,
    .resolve         = ut_resolve,
    .report_progress = ut_progress,
    .ui_bundle_url   = ut_bundle,
    .get_source      = ut_get_source,
    .set_source      = ut_set_source,
    .needs_sign_in   = ut_needs_sign_in,
    .ui_embedded     = "mediaserver",
};
