/* Registers the app as a home-screen tile on the console.
 *
 * The files only become a tile once the console's own installer has been told about them. It
 * reads the folder this program points it at and adds the title to the home screen; until then
 * a copied folder is just files. This is the same route the SDK's own install_app sample takes,
 * and it is the one the payload loader can run over the network (`make install`).
 *
 * A native title cannot make raw syscalls, so this is an ordinary ELF linked against the
 * console's library stubs, exactly like the sample it follows.
 */
#include <stdio.h>

int sceAppInstUtilInitialize(void);
int sceAppInstUtilAppInstallTitleDir(const char *title_id, const char *path, void *reserved);

int main(void) {
  int err;

  if ((err = sceAppInstUtilInitialize()) != 0) {
    printf("the console wouldn't start its installer: %x\n", err);
    return 1;
  }
  if ((err = sceAppInstUtilAppInstallTitleDir(TITLE_ID, "/user/app/", 0)) != 0) {
    printf("the console wouldn't install %s: %x\n", TITLE_ID, err);
    return 1;
  }
  printf("installed %s: look for UltimateTV on the home screen\n", TITLE_ID);
  return 0;
}
