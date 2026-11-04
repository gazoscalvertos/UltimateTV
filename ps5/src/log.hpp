// The one place the app writes down what the console told it.
//
// There is no terminal on a PlayStation 5 and the payload loader's output never reaches the
// living room, so a failure there is a black screen and nothing else. Everything that can fail on
// the way to a picture says so through here, to stderr and to a file, and main.cpp also puts the
// worst of it on the screen as a notification.
#ifndef UTV_LOG_HPP
#define UTV_LOG_HPP

namespace utv {

/**
 * Starts writing to `path`, keeping stderr working as well.
 *
 * A console that has no writable folder there simply loses the file; logging never fails.
 */
void logTo(const char* path);

/** Writes one formatted line with a timestamp. */
void logLine(const char* format, ...)
#if defined(__GNUC__)
    __attribute__((format(printf, 1, 2)))
#endif
    ;

/** Closes the file, if one is open. */
void logClose();

}  // namespace utv

#endif  // UTV_LOG_HPP
