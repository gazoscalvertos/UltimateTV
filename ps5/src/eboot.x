/*  UltimateTV for the PlayStation 5: the linker script that turns the app into
 *  a home-screen tile.
 *
 *  It is the SDK's own `ldscripts/elf_x86_64.x` (text, read-only data, data,
 *  dynamic section, unwind tables) with one addition: a `.sce_process_param`
 *  section in a program header of type 0x61000001. The console's app loader
 *  reads that header for a home-screen title, so a tile built without it is
 *  refused, and the SDK's other script (`samples/install_app/eboot.x`) only
 *  works for the tiny static binary in that sample because it drops the
 *  dynamic section and the unwind tables a C++ app with static libraries
 *  needs.
 */

OUTPUT_FORMAT("elf64-x86-64")
OUTPUT_ARCH(i386:x86-64)

PHDRS {
	ph_text           PT_LOAD     FLAGS (0x7);
	ph_rodata         PT_LOAD     FLAGS (0x6);
	ph_data           PT_LOAD     FLAGS (0x6);
	ph_dyn            PT_DYNAMIC;
	ph_sce_procparam  0x61000001  FLAGS (0x4);
}

SECTIONS {
	PROVIDE_HIDDEN (__image_start = .);

	.text : ALIGN(CONSTANT(MAXPAGESIZE)) {
	    PROVIDE_HIDDEN (__text_start = .);
	    *(.text .text.*)
	    PROVIDE_HIDDEN (__text_end = .);
	} : ph_text

	.plt : { *(.plt) }

	.eh_frame_hdr : ALIGN(CONSTANT(MAXPAGESIZE)) {
	    PROVIDE_HIDDEN(__eh_frame_hdr_start = .);
	    KEEP(*(.eh_frame_hdr))
	    PROVIDE_HIDDEN(__eh_frame_hdr_end = .);
	} : ph_rodata

	.eh_frame : {
	    PROVIDE_HIDDEN(__eh_frame_start = .);
	    KEEP(*(.eh_frame))
	    PROVIDE_HIDDEN(__eh_frame_end = .);
	}

	.gcc_except_table : { *(.gcc_except_table*) }
	.data.rel.ro : { *(.data.rel.ro .data.rel.ro.*); }
	.got : { *(.got) }
	.got.plt : { *(.got.plt) }

	.rodata : { *(.rodata .rodata.*) }

	.preinit_array : {
	    PROVIDE_HIDDEN (__preinit_array_start = .);
	    KEEP(*(.preinit_array))
	    PROVIDE_HIDDEN (__preinit_array_end = .);
	}
	.init_array : {
	    PROVIDE_HIDDEN (__init_array_start = .);
	    KEEP(*(SORT_BY_INIT_PRIORITY(.init_array.*) SORT_BY_INIT_PRIORITY(.ctors.*)))
	    KEEP(*(.init_array .ctors))
	    PROVIDE_HIDDEN (__init_array_end = .);
	}
	.fini_array : {
	    PROVIDE_HIDDEN (__fini_array_start = .);
	    KEEP(*(SORT_BY_INIT_PRIORITY(.fini_array.*) SORT_BY_INIT_PRIORITY(.dtors.*)))
	    KEEP(*(.fini_array .dtors))
	    PROVIDE_HIDDEN (__fini_array_end = .);
	}

	.dynamic : ALIGN(CONSTANT(MAXPAGESIZE)) {
	    PROVIDE_HIDDEN (_DYNAMIC = .);
	    *(.dynamic)
	} : ph_rodata : ph_dyn

	.data : ALIGN(CONSTANT(MAXPAGESIZE)) {
	    *(.data .data.*)
	} : ph_data

	.bss : {
	    PROVIDE_HIDDEN (__bss_start = .);
	    *(.bss .bss.*);
	    *(COMMON)
	    PROVIDE_HIDDEN (__bss_end = .);
	}

	/* The console's app loader reads this. A home-screen tile needs it. */
	.sce_process_param : ALIGN(32) {
	    KEEP(*(.sce_process_param))
	} : ph_sce_procparam

	PROVIDE_HIDDEN (__image_end = .);
}
