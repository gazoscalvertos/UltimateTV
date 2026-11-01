// Favourites for the profile this phone is on: the films, shows and guide channels it has
// starred. Kept on the Hub, one set per profile, so the TV and this app agree.

package tv.ultimate.client

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

object Favourites {
    private val _state = MutableStateFlow(FavouriteState(emptyList(), emptyList()))
    val state: StateFlow<FavouriteState> = _state

    /** Fetches them again (opening a page, or after switching profile). Quiet when the Hub is away. */
    suspend fun load() {
        runCatching { App.instance.hub.favourites() }.onSuccess { _state.value = it }
    }

    suspend fun setTitle(d: TitleDetails, on: Boolean) {
        _state.value = App.instance.hub.favouriteTitle(d, on)
    }

    suspend fun setChannel(id: String, on: Boolean) {
        _state.value = App.instance.hub.favouriteChannel(id, on)
    }
}
