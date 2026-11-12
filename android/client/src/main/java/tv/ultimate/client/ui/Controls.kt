// Buttons, chips and the menu's pills, drawn like the TV's: a quiet translucent shape that turns
// solid (the theme's "selected" colour) and lifts a little when the remote is on it. Material's own
// buttons only tint a focused button, which you can't see from a sofa.

package tv.ultimate.client.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private enum class Look { Filled, Quiet, Text }

@Composable
private fun UtvButton(onClick: () -> Unit, modifier: Modifier, enabled: Boolean, look: Look, content: @Composable RowScope.() -> Unit) {
    val c = LocalUtv.current
    val tv = rememberIsTv()
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.05f else 1f, label = "buttonFocus")
    val rest = when (look) {
        Look.Filled -> c.lift(0.22f)
        Look.Quiet -> c.lift(0.12f)
        Look.Text -> Color.Transparent
    }
    val ink = if (focused) c.onSel else if (look == Look.Text) c.accent else c.fg
    Row(
        modifier
            .onFocusChanged { focused = it.isFocused }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .alpha(if (enabled) 1f else 0.4f)
            .clip(RoundedCornerShape(if (tv) 8.dp else 20.dp))
            .background(if (focused) c.sel else rest)
            .clickable(enabled = enabled, onClick = onClick)
            .defaultMinSize(minHeight = if (tv) 34.dp else 40.dp)
            .padding(horizontal = if (look == Look.Text) 12.dp else 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        CompositionLocalProvider(LocalContentColor provides ink) {
            ProvideTextStyle(MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold)) { content() }
        }
    }
}

/** The main button on a screen (Watch, Resume). */
@Composable
fun Button(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) =
    UtvButton(onClick, modifier, enabled, Look.Filled, content)

/** The other buttons next to it (Download, Save for later). */
@Composable
fun OutlinedButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) =
    UtvButton(onClick, modifier, enabled, Look.Quiet, content)

@Composable
fun TextButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) =
    UtvButton(onClick, modifier, enabled, Look.Text, content)

/** A round icon button (heart, play on the TV, more). */
@Composable
fun IconButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable () -> Unit) {
    val c = LocalUtv.current
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.1f else 1f, label = "iconFocus")
    Box(
        modifier
            .onFocusChanged { focused = it.isFocused }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .alpha(if (enabled) 1f else 0.4f)
            .size(if (rememberIsTv()) 36.dp else 44.dp)
            .clip(CircleShape)
            .background(if (focused) c.sel else Color.Transparent)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        CompositionLocalProvider(LocalContentColor provides (if (focused) c.onSel else c.fg)) { content() }
    }
}

/** The TV's chip: a pill that is tinted when chosen and solid when the remote is on it. */
@Composable
fun FilterChip(
    selected: Boolean,
    onClick: () -> Unit,
    label: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    leadingIcon: (@Composable () -> Unit)? = null,
) {
    val c = LocalUtv.current
    val tv = rememberIsTv()
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "chipFocus")
    val bg = if (focused) c.sel else if (selected) c.accent.copy(alpha = 0.22f) else c.lift(0.08f)
    val ink = if (focused) c.onSel else if (selected) c.fg else c.muted
    Row(
        modifier
            .onFocusChanged { focused = it.isFocused }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(RoundedCornerShape(if (tv) 14.dp else 18.dp))
            .background(bg)
            .clickable(onClick = onClick)
            .heightIn(min = if (tv) 28.dp else 36.dp)
            .padding(horizontal = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        CompositionLocalProvider(LocalContentColor provides ink) {
            ProvideTextStyle(MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold)) {
                leadingIcon?.invoke()
                label()
            }
        }
    }
}
