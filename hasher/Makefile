# Needs librandomx (the RandomX of the Scash node, built by its depends system: depends/<host>/lib/librandomx.a, include/randomx.h).
# RANDOMX=/path/to/prefix make        (prefix has include/randomx.h and lib/librandomx.a)
# STATIC=-static makes a binary that runs on any Linux (build it where the node is built; a static glibc needs the whole pthread library,
# else std::thread crashes).
RANDOMX ?= /usr/local
CXX ?= g++
STATIC ?=
PTHREAD = -pthread
ifneq ($(STATIC),)
PTHREAD = -Wl,--whole-archive -lpthread -Wl,--no-whole-archive
endif
rxhash: rxhash.cpp
	$(CXX) -O2 -std=c++11 $(STATIC) -I$(RANDOMX)/include -o $@ $< $(RANDOMX)/lib/librandomx.a $(PTHREAD)
clean:
	rm -f rxhash
